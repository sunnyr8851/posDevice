// App.js
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';

import { BleManager } from 'react-native-ble-plx';
import { NativeModules } from 'react-native';
import {
  requestMultiple,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { BleAdvertiserModule } = NativeModules;
const manager = new BleManager();

/* -------------------------
   Replace these with your real backend endpoints
   - VERIFY_POS_URL: verify pos id
   - VERIFY_RUNNER_URL: verify runner id
   - RUNNER_UPDATE_URL: runner proximity update endpoint
--------------------------- */
const API_VERIFY_POS = 'https://your-backend.example.com/verify-pos';
const API_VERIFY_RUNNER = 'https://your-backend.example.com/verify-runner';
const API_RUNNER_UPDATE = 'https://your-backend.example.com/runner/update';

/* ---------------------------------------------
   Small short ID generator (not used for manual IDs)
--------------------------------------------- */
function shortId() {
  return 'xxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/* ---------------------------------------------
   BLE PERMISSIONS (Android 12+)
--------------------------------------------- */
async function requestBlePermissions() {
  if (Platform.OS !== 'android') return true;

  const perms = [
    PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
    PERMISSIONS.ANDROID.BLUETOOTH_ADVERTISE,
    PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
    PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
  ];

  try {
    const result = await requestMultiple(perms);
    const ok = Object.values(result).every(
      r => r === RESULTS.GRANTED || r === RESULTS.LIMITED,
    );
    return ok;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------
   UTILS: parse base64 payload "POS_ID|ORDER_ID"
   Accepts either manufacturerData or serviceData (base64)
--------------------------------------------- */
function parsePayload(base64Str) {
  if (!base64Str) return null;

  try {
    let raw = Buffer.from(base64Str, 'base64').toString('utf8');

    // Remove any garbage bytes before "POS"
    const idx = raw.indexOf('POS');
    if (idx > 0) {
      raw = raw.substring(idx);
    }

    // Must be POS_ID|ORDER_ID
    const parts = raw.split('|');
    if (parts.length < 2) return null;

    const posId = parts[0].trim();
    const orderId = parts[1].trim();

    if (!posId.startsWith('POS')) return null;

    return { posId, orderId };
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------
   POS COMPONENT (broadcasts posId|orderId)
--------------------------------------------- */
function PosScreen({ deviceId }) {
  // deviceId is the manually-verified POS id (saved locally)
  const [orderId, setOrderId] = useState('ORDER001');
  const [advertising, setAdvertising] = useState(false);
  const [busy, setBusy] = useState(false);

  async function startAdvertising() {
    if (!deviceId) {
      Alert.alert('POS ID missing', 'Please set a POS ID in onboarding.');
      return;
    }

    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert('Permissions Needed', 'Please allow Bluetooth permissions.');
      return;
    }

    try {
      setBusy(true);
      const supported = await BleAdvertiserModule.isAdvertisingSupported();
      if (!supported) {
        Alert.alert(
          'Not Supported',
          'This device cannot advertise BLE signals.',
        );
        setBusy(false);
        return;
      }
    } catch (err) {
      setBusy(false);
      Alert.alert('Error', String(err));
      return;
    }

    const payload = `${deviceId}|${orderId}`;
    const base64 = Buffer.from(payload, 'utf8').toString('base64');

    try {
      await BleAdvertiserModule.startAdvertising(base64);
      setAdvertising(true);
    } catch (err) {
      Alert.alert('Advertise Error', String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopAdvertising() {
    try {
      await BleAdvertiserModule.stopAdvertising();
    } catch (err) {
      // ignore
    } finally {
      setAdvertising(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>POS Mode (Broadcast)</Text>

      <Text style={{ marginBottom: 6 }}>POS ID (locked):</Text>
      <TextInput style={styles.input} value={deviceId} editable={false} />

      <Text style={{ marginTop: 12 }}>Order ID:</Text>
      <TextInput
        style={styles.input}
        value={orderId}
        onChangeText={setOrderId}
        placeholder="Enter order id"
      />

      <TouchableOpacity
        style={styles.button}
        onPress={advertising ? stopAdvertising : startAdvertising}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {advertising ? 'Stop Advertising' : 'Start Advertising'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={{ marginTop: 20 }}>
        Broadcasting:{' '}
        {advertising ? `${deviceId} | ${orderId}` : 'Not broadcasting'}
      </Text>
    </View>
  );
}

/* ---------------------------------------------
   RUNNER COMPONENT (scans and lists nearby POS only)
--------------------------------------------- */
function RunnerScreen({ deviceId }) {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState({}); 

  const lastRSSI = useRef({});
  const bufferRef = useRef({});      // live RSSI buffer
  const devicesRef = useRef({});     // used for backend sending
const lastUIRSSI = useRef({});

  /* --------------------------
     PROCESS DEVICE (fast updates)
  ---------------------------- */
  function processDevice(device, payload) {
    const posKey = payload.posId;
    const newRSSI = device.rssi;

    // compute warmer/colder with threshold
    let tempStatus = "Start";
    if (lastRSSI.current[posKey] != null) {
      const oldRSSI = lastRSSI.current[posKey];
      const diff = newRSSI - oldRSSI;

      if (Math.abs(diff) < 10) tempStatus = "Similar";
      else if (diff >= 10) tempStatus = "🔥 Warmer";
      else if (diff <= -10) tempStatus = "❄️ Colder";
    }
    lastRSSI.current[posKey] = newRSSI;

    // Clean POS ID
    const cleanPosId = payload.posId.replace(/[^A-Za-z0-9\-]/g, "").trim();

    // Store only in buffer (not UI)
    bufferRef.current[cleanPosId] = {
      posId: cleanPosId,
      orderId: payload.orderId,
      rssi: newRSSI,
      // status: tempStatus,
    };
  }

  /* --------------------------
     START SCANNING
  ---------------------------- */
  async function startScan() {
    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert("Permissions Needed", "Allow Bluetooth permissions.");
      return;
    }

    lastRSSI.current = {};
    bufferRef.current = {};
    devicesRef.current = {};
    setDevices({});
    setRunning(true);

    manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
      if (err) return;

      const raw =
        device.manufacturerData ||
        (device.serviceData && Object.values(device.serviceData)[0]);

      if (!raw) return;

      const payload = parsePayload(raw);
      if (!payload) return;

      processDevice(device, payload);
    });
  }

  function stopScan() {
    manager.stopDeviceScan();
    setRunning(false);
  }

  /* --------------------------
     UPDATE UI EVERY 3 SECONDS
  ---------------------------- */
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      const snapshot = { ...bufferRef.current };

      setDevices(snapshot);
      devicesRef.current = snapshot;
    }, 3000);

    return () => clearInterval(interval);
  }, [running]);
  useEffect(() => {
  if (!running) return;

  const interval = setInterval(() => {
    const snapshot = { ...bufferRef.current };

    // build final devices object with warmer/colder logic (3 seconds resolution)
    const output = {};

    Object.keys(snapshot).forEach(posId => {
      const currentRSSI = snapshot[posId].rssi;
      const oldRSSI = lastUIRSSI.current[posId] ?? null;

      let status = "Similar";

      if (oldRSSI !== null) {
        const diff = currentRSSI - oldRSSI;

        if (Math.abs(diff) < 3) status = "Similar";
        else if (diff >= 3) status = "🔥 Warmer";
        else if (diff <= -3) status = "❄️ Colder";
      }

      // Save for next 3-sec comparison
      lastUIRSSI.current[posId] = currentRSSI;

      output[posId] = {
        posId,
        orderId: snapshot[posId].orderId,
        rssi: currentRSSI,
        status
      };
    });

    // Update UI + backend reference
    setDevices(output);
    devicesRef.current = output;

  }, 3000); // update every 3 seconds

  return () => clearInterval(interval);
}, [running]);


  /* --------------------------
     SEND BACKEND EVERY 3 SEC
  ---------------------------- */
  async function sendRunnerUpdate(runnerName, deviceList) {
    if (!runnerName || deviceList.length === 0) return;

    const posArray = deviceList.map(d => ({
      deviceId: d.posId.replace(/[^A-Za-z0-9\-]/g, ""),
      rssi: d.rssi
    }));

    try {
      const resp = await fetch("https://rssi-server.onrender.com/api/rssi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerDeviceName: runnerName, pos: posArray }),
      });

      const json = await resp.json();
      console.log("Runner Update:", json);
    } catch (e) {
      console.log("Runner update error:", e);
    }
  }

  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      const list = Object.values(devicesRef.current);
      sendRunnerUpdate(deviceId, list);
    }, 3000);

    return () => clearInterval(interval);
  }, [running]);

  /* --------------------------
     RENDER UI
  ---------------------------- */
  const deviceList = Object.values(devices).sort((a, b) => b.rssi - a.rssi);

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>Runner Mode (Scanner)</Text>

      <Text style={{ marginBottom: 6 }}>Runner ID:</Text>
      <TextInput style={styles.input} value={deviceId} editable={false} />

      <TouchableOpacity
        style={styles.button}
        onPress={running ? stopScan : startScan}
      >
        <Text style={styles.buttonText}>
          {running ? "Stop Scan" : "Start Scan"}
        </Text>
      </TouchableOpacity>

      <View style={{ marginTop: 18, flex: 1 }}>
        {deviceList.length === 0 ? (
          <Text style={{ color: "#555" }}>Waiting for POS devices...</Text>
        ) : (
          <ScrollView>
            {deviceList.map(d => (
              <View key={d.posId} style={styles.deviceCard}>
                <Text style={styles.deviceTitle}>POS: {d.posId}</Text>
                <Text style={styles.deviceRSSI}>RSSI: {d.rssi} dBm</Text>
                <Text style={[
                  styles.deviceStatus,
                  {
                    color: d.status.includes("Warmer")
                      ? "#4CAF50"
                      : d.status.includes("Colder")
                      ? "#F44336"
                      : "#666",
                  },
                ]}>
                  {d.status}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/* ---------------------------------------------
   ONBOARDING: ask role and manual ID and verify with backend
--------------------------------------------- */
function Onboarding({ onComplete }) {
  const [role, setRole] = useState(null); // "pos" | "runner"
  const [inputId, setInputId] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!role) {
      Alert.alert('Choose role', 'Please select POS or Runner.');
      return;
    }
    if (!inputId || inputId.trim().length === 0) {
      Alert.alert('Enter ID', 'Please enter your device ID.');
      return;
    }

    setLoading(true);

    try {
      let url = '';
      let body = {};

      if (role === 'pos') {
        url = 'https://rssi-server.onrender.com/api/pos/login';
        body = { deviceId: inputId.trim() };
      } else {
        url = 'https://rssi-server.onrender.com/api/runners/login';
        body = { runnerDeviceName: inputId.trim() };
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await resp.json();
      console.log('LOGIN RESPONSE:', json);

      let successObj = null;

      if (role === 'pos') {
        successObj = json.pos; // backend returns json.pos
        if (!successObj || successObj.deviceId !== inputId.trim()) {
          Alert.alert('Verification failed', json.message || 'Invalid POS ID');
          setLoading(false);
          return;
        }
      } else {
        successObj = json.runner; // backend returns json.runner
        if (!successObj || successObj.runnerDeviceName !== inputId.trim()) {
          Alert.alert(
            'Verification failed',
            json.message || 'Invalid Runner Name',
          );
          setLoading(false);
          return;
        }
      }

      // Save local device role + id + database record ID
      await AsyncStorage.setItem(
        'app_role_info',
        JSON.stringify({
          role,
          deviceId: inputId.trim(),
          dbId: successObj.id,
        }),
      );

      onComplete({
        role,
        deviceId: inputId.trim(),
        dbId: successObj.id,
      });
    } catch (e) {
      Alert.alert('Network error', String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>Setup</Text>

      <Text style={{ marginBottom: 8 }}>Select your role:</Text>
      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeButton, role === 'pos' && styles.activeMode]}
          onPress={() => setRole('pos')}
        >
          <Text style={styles.modeText}>POS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeButton, role === 'runner' && styles.activeMode]}
          onPress={() => setRole('runner')}
        >
          <Text style={styles.modeText}>Runner</Text>
        </TouchableOpacity>
      </View>

      <Text style={{ marginTop: 16 }}>Enter your ID (provided by admin):</Text>
      <TextInput
        style={styles.input}
        value={inputId}
        onChangeText={setInputId}
        placeholder={role === 'pos' ? 'e.g. POS001' : 'e.g. RUN005'}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify & Save</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/* ---------------------------------------------
   APP (main)
--------------------------------------------- */
export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [modeMounted, setModeMounted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('app_role_info');
        console.log(raw);
        if (raw) {
          const { role, deviceId } = JSON.parse(raw);
          setRole(role);
          setDeviceId(deviceId);
        }
      } catch (e) {
        // ignore
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  function onOnboardingComplete({ role, deviceId }) {
    setRole(role);
    setDeviceId(deviceId);
    setModeMounted(true);
  }

  // If not ready yet (loading storage)
  if (!isReady) {
    return (
      <View
        style={[
          styles.screen,
          { alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Show onboarding if no role stored
  if (!role) {
    return <Onboarding onComplete={onOnboardingComplete} />;
  }
  async function logoutPOS(deviceId) {
    try {
      const resp = await fetch(
        'https://rssi-server.onrender.com/api/pos/logout',
        {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId }),
        },
      );

      const json = await resp.json();
      console.log('POS Logout Response:', json);
      return json;
    } catch (e) {
      console.log('POS Logout Error:', e);
      return null;
    }
  }

  async function logoutRunner(deviceId) {
    try {
      const resp = await fetch(
        'https://rssi-server.onrender.com/api/runners/logout',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runnerDeviceName: deviceId }),
        },
      );

      const json = await resp.json();
      console.log('Runner Logout Response:', json);
      return json;
    } catch (e) {
      console.log('Runner Logout Error:', e);
      return null;
    }
  }

  async function handleLogout() {
    Alert.alert('Logout', 'Do you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            // stop scanning or advertising before logout
            try {
              manager.stopDeviceScan();
            } catch (_) {}
            try {
              await BleAdvertiserModule.stopAdvertising();
            } catch (_) {}

            if (role === 'pos') {
              await logoutPOS(deviceId);
            } else {
              await logoutRunner(deviceId);
            }

            // Clear local storage
            await AsyncStorage.removeItem('app_role_info');

            // Reset UI
            setRole(null);
            setDeviceId(null);
          } catch (e) {
            Alert.alert('Error', 'Logout failed.');
          }
        },
      },
    ]);
  }

  // Main POS or Runner screens
  return (
    <View style={styles.appRoot}>
      <View style={styles.headerBar}>
        <Text style={styles.headerBarText}>
          {role === 'pos' ? `POS — ${deviceId}` : `Runner — ${deviceId}`}
        </Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={{ color: '#ff3333' }}>Logout</Text>
        </TouchableOpacity>
      </View>

      {role === 'pos' ? (
        <PosScreen deviceId={deviceId} />
      ) : (
        <RunnerScreen deviceId={deviceId} />
      )}
    </View>
  );
}

/* ---------------------------------------------
   STYLES (static UI)
--------------------------------------------- */
const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerBar: {
    height: 60,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
  },
  headerBarText: { fontWeight: '700' },

  screen: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  header: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
    color: '#000',
  },

  input: {
    borderWidth: 1,
    borderColor: '#CED4DA',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    marginVertical: 10,
    fontSize: 16,
    color: '#000',
  },

  button: {
    marginTop: 15,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },

  modeSwitch: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 12,
    backgroundColor: '#E9ECEF',
  },
  modeButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ADB5BD',
    backgroundColor: '#FFFFFF',
  },
  activeMode: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  modeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },

  deviceCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  deviceTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  deviceRSSI: {
    marginTop: 4,
    fontSize: 15,
    color: '#444',
  },
  deviceStatus: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: '700',
  },
});

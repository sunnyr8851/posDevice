import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";

import { BleManager } from "react-native-ble-plx";
import { NativeModules } from "react-native";
import { requestMultiple, PERMISSIONS, RESULTS } from "react-native-permissions";
import { Buffer } from "buffer";
import AsyncStorage from "@react-native-async-storage/async-storage";
// import { v4 as uuidv4 } from "uuid";

function uuidv4() {
  return 'xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}


const { BleAdvertiserModule } = NativeModules;
const manager = new BleManager();

/* ---------------------------------------------
   BLE PERMISSIONS (Android 12+)
--------------------------------------------- */
async function requestBlePermissions() {
  if (Platform.OS !== "android") return true;

  const perms = [
    PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
    PERMISSIONS.ANDROID.BLUETOOTH_ADVERTISE,
    PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
    PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
  ];

  try {
    const result = await requestMultiple(perms);
    const ok = Object.values(result).every(
      (r) => r === RESULTS.GRANTED || r === RESULTS.LIMITED
    );
    return ok;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------
   UTILS: parse base64 payload "POS|ORDER"
--------------------------------------------- */
function parsePayload(base64Str) {
  try {
    const raw = Buffer.from(base64Str, "base64").toString("utf8");
    const [posId, orderId] = raw.split("|");
    return { posId, orderId };
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------
   POS DEVICE (ADVERTISER)
--------------------------------------------- */
function PosScreen({posId}) {
  // const [posId, setPosId] = useState("POS123");
  const [orderId, setOrderId] = useState("ORDER555");
  const [advertising, setAdvertising] = useState(false);

  async function startAdvertising() {
    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert("Permissions Needed", "Please allow Bluetooth permissions.");
      return;
    }

    try {
      const supported = await BleAdvertiserModule.isAdvertisingSupported();
      if (!supported) {
        Alert.alert("Not Supported", "This device cannot advertise BLE signals.");
        return;
      }
    } catch (err) {
      Alert.alert("Error", String(err));
      return;
    }

    const payload = `${posId}|${orderId}`;
    const base64 = Buffer.from(payload, "utf8").toString("base64");

    try {
      await BleAdvertiserModule.startAdvertising(base64);
      setAdvertising(true);
    } catch (err) {
      Alert.alert("Advertise Error", String(err));
    }
  }

  async function stopAdvertising() {
    try {
      await BleAdvertiserModule.stopAdvertising();
    } catch (err) {}
    setAdvertising(false);
  }

  return (
    <View style={{ padding: 20 }}>
      <Text style={styles.header}>POS Mode (Broadcast)</Text>

      <TextInput
        style={styles.input}
        value={posId}
        
        // onChangeText={setPosId}
        placeholder="POS ID"
      />

      {/* <TextInput
        style={styles.input}
        value={orderId}
        onChangeText={setOrderId}
        placeholder="Order ID"
      /> */}

      <TouchableOpacity
        style={styles.button}
        onPress={advertising ? stopAdvertising : startAdvertising}
      >
        <Text style={styles.buttonText}>
          {advertising ? "Stop Advertising" : "Start Advertising"}
        </Text>
      </TouchableOpacity>

      <Text style={{ marginTop: 20 }}>
        Broadcasting: {advertising ? `${posId} | ${orderId}` : "Not broadcasting"}
      </Text>
    </View>
  );
}

/* ---------------------------------------------
   RUNNER DEVICE (SCANNER)
--------------------------------------------- */
// function RunnerScreen() {
//   const [running, setRunning] = useState(false);
//   const [status, setStatus] = useState("Idle");
//   const [current, setCurrent] = useState(null);
//   const lastRssi = useRef(null);

//   function processDevice(device) {
//     const rssi = device.rssi;
//     const payload = parsePayload(device.manufacturerData);

//     if (!payload) return;

//     setCurrent({ ...payload, rssi });

//     if (lastRssi.current === null) {
//       setStatus("Start");
//     } else {
//       if (rssi > lastRssi.current) setStatus("🔥 WARMER");
//       else if (rssi < lastRssi.current) setStatus("❄️ COLDER");
//       else setStatus("Same");
//     }

//     lastRssi.current = rssi;
//   }

//   async function startScan() {
//     const ok = await requestBlePermissions();
//     if (!ok) {
//       Alert.alert("Permissions Needed", "Allow Bluetooth permissions.");
//       return;
//     }

//     lastRssi.current = null;
//     setStatus("Scanning...");
//     setRunning(true);

//     manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
//       if (err) {
//         setStatus("Scan Error");
//         return;
//       }
//       processDevice(device);
//     });
//   }

//   function stopScan() {
//     manager.stopDeviceScan();
//     setRunning(false);
//     setStatus("Stopped");
//   }

//   return (
//     <View style={{ padding: 20 }}>
//       <Text style={styles.header}>Runner Mode (Scanner)</Text>

//       <TouchableOpacity
//         style={styles.button}
//         onPress={running ? stopScan : startScan}
//       >
//         <Text style={styles.buttonText}>
//           {running ? "Stop Scan" : "Start Scan"}
//         </Text>
//       </TouchableOpacity>

//       <Text style={styles.statusText}>Status: {status}</Text>

//       {current && (
//         <>
//           <Text style={styles.foundText}>
//             Found POS: {current.posId} | {current.orderId}
//           </Text>
//           <Text style={styles.rssiText}>RSSI: {current.rssi} dBm</Text>
//         </>
//       )}
//     </View>
//   );
// }
/* ---------------------------------------------
   RUNNER DEVICE (MULTI-POS SCANNER WITH LIST)
--------------------------------------------- */
// function RunnerScreen() {
//   const [running, setRunning] = useState(false);
//   const [devices, setDevices] = useState({});  // Store all POS devices
//   const lastRSSI = useRef({}); // Track previous RSSI per POS

//   function processDevice(device) {
//   // must have manufacturerData
//   if (!device.manufacturerData) return;

//   // decode payload
//   const payload = parsePayload(device.manufacturerData);
//   if (!payload) return; // ignore non-POS devices

//   // ensure correct format: POS_ID|ORDER_ID
//   if (!payload.posId || !payload.orderId) return;

//   const posKey = payload.posId;
//   const newRSSI = device.rssi;

//   let tempStatus = "Start";

//   if (lastRSSI.current[posKey] != null) {
//     const oldRSSI = lastRSSI.current[posKey];
//     if (newRSSI > oldRSSI) tempStatus = "🔥 Warmer";
//     else if (newRSSI < oldRSSI) tempStatus = "❄️ Colder";
//     else tempStatus = "Same";
//   }

//   // store device
//   setDevices(prev => ({
//     ...prev,
//     [posKey]: {
//       posId: payload.posId,
//       orderId: payload.orderId,
//       rssi: newRSSI,
//       status: tempStatus,
//     }
//   }));

//   lastRSSI.current[posKey] = newRSSI;
// }


//   async function startScan() {
//     const ok = await requestBlePermissions();
//     if (!ok) {
//       Alert.alert("Permissions Needed", "Allow Bluetooth permissions.");
//       return;
//     }

//     lastRSSI.current = {};
//     setDevices({});
//     setRunning(true);

//     manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
//       if (err) {
//         Alert.alert("Scan Error", err.message);
//         return;
//       }
//       processDevice(device);
//     });
//   }

//   function stopScan() {
//     manager.stopDeviceScan();
//     setRunning(false);
//   }

//   // Convert object → array and sort by RSSI (higher = closer)
//   const deviceList = Object.values(devices).sort((a, b) => b.rssi - a.rssi);

//   return (
//     <View style={{ padding: 20, flex: 1 }}>
//       <Text style={styles.header}>Runner Mode (Multi-POS Scan)</Text>

//       <TouchableOpacity
//         style={styles.button}
//         onPress={running ? stopScan : startScan}
//       >
//         <Text style={styles.buttonText}>
//           {running ? "Stop Scan" : "Start Scan"}
//         </Text>
//       </TouchableOpacity>

//       {deviceList.length === 0 ? (
//         <Text style={{ marginTop: 20 }}>No POS detected yet...</Text>
//       ) : (
//         <View style={{ marginTop: 20 }}>
//           {deviceList.map((d, index) => (
//             <View key={index} style={styles.deviceCard}>
//               <Text style={styles.deviceTitle}>
//                 POS: {d.posId} | Order: {d.orderId}
//               </Text>
//               <Text style={styles.deviceRSSI}>RSSI: {d.rssi} dBm</Text>
//               <Text style={styles.deviceStatus}>{d.status}</Text>
//             </View>
//           ))}
//         </View>
//       )}
//     </View>
//   );
// }

function RunnerScreen({runnerId}) {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState({});
  const lastRSSI = useRef({});

function processDevice(device) {
  const payload = device.payload;  // already decoded
  const { posId, orderId } = payload;
  const newRSSI = device.rssi;

  const posKey = posId;
  let tempStatus = "Start";

  if (lastRSSI.current[posKey] != null) {
    const oldRSSI = lastRSSI.current[posKey];
    if (newRSSI > oldRSSI) tempStatus = "🔥 Warmer";
    else if (newRSSI < oldRSSI) tempStatus = "❄️ Colder";
    else tempStatus = "Same";
  }

  setDevices(prev => ({
    ...prev,
    [posKey]: {
      posId,
      orderId,
      rssi: newRSSI,
      status: tempStatus,
    },
  }));

  lastRSSI.current[posKey] = newRSSI;
}



  async function startScan() {
    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert("Permissions Needed", "Allow Bluetooth permissions.");
      return;
    }

    lastRSSI.current = {};
    setDevices({});
    setRunning(true);

   manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
  if (err) return;

  // Extract raw POS data
  const raw =
    device.manufacturerData ||
    (device.serviceData && Object.values(device.serviceData)[0]);

  if (!raw) return; // ignore non-POS

  // Decode the POS payload
  const payload = parsePayload(raw);
  if (!payload || !payload.posId || !payload.orderId) return; // still ignore

  // Now it's a valid POS device
  processDevice({
    ...device,
    payload,
  });
});

  }

  function stopScan() {
    manager.stopDeviceScan();
    setRunning(false);
  }

  const deviceList = Object.values(devices).sort((a, b) => b.rssi - a.rssi);

  return (
    <View style={{ padding: 20, flex: 1 }}>
      <Text style={styles.header}>Runner Mode (POS-Only Scan)</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={running ? stopScan : startScan}
      >
        <Text style={styles.buttonText}>
          {running ? "Stop Scan" : "Start Scan"}
        </Text>
      </TouchableOpacity>

      {deviceList.length === 0 ? (
        <Text style={{ marginTop: 20 }}>Scanning for POS devices...</Text>
      ) : (
        <View style={{ marginTop: 20 }}>
          {deviceList.map((d, i) => (
            <View key={i} style={styles.deviceCard}>
              <Text style={styles.deviceTitle}>
                POS: {d.posId} | ORDER: {d.orderId}
              </Text>
              <Text style={styles.deviceRSSI}>RSSI: {d.rssi} dBm</Text>
              <Text style={styles.deviceStatus}>{d.status}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}


/* ---------------------------------------------
   MAIN APP MODE SWITCHER
--------------------------------------------- */
async function getOrCreateIds() {
  let posId = await AsyncStorage.getItem("pos_id");
  let runnerId = await AsyncStorage.getItem("runner_id");
  if (!posId) {
    posId = "POS-" + uuidv4();
    await AsyncStorage.setItem("pos_id", posId);
  }

  if (!runnerId) {
    runnerId = "RUN-" + uuidv4();
    await AsyncStorage.setItem("runner_id", runnerId);
  }

  return { posId, runnerId };
}

export default function App() {
  const [mode, setMode] = useState("pos");
  const [posId, setPosId] = useState(null);
const [runnerId, setRunnerId] = useState(null);

useEffect(() => {
  (async () => {
    console.log("first")
    const { posId, runnerId} = await getOrCreateIds();
    console.log(posId, runnerId)
    setPosId(posId);
    setRunnerId(runnerId);
  })();
}, []);
  return (
   <View style={styles.screen}>

      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeButton, mode === "pos" && styles.activeMode]}
          onPress={() => setMode("pos")}
        >
          <Text style={styles.modeText}>POS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeButton, mode === "runner" && styles.activeMode]}
          onPress={() => setMode("runner")}
        >
          <Text style={styles.modeText}>Runner</Text>
        </TouchableOpacity>
      </View>

      {mode === "pos" ? <PosScreen  posId={posId}/> : <RunnerScreen runnerId={runnerId}/>}
    </View>
  );
}

/* ---------------------------------------------
   STYLES
--------------------------------------------- */
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F5F5", // static light background
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  header: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
    color: "#000", // always black
  },

  input: {
    borderWidth: 1,
    borderColor: "#CED4DA",
    backgroundColor: "#FFFFFF",
    padding: 12,
    borderRadius: 10,
    marginVertical: 10,
    fontSize: 16,
    color: "#000",
  },

  button: {
    marginTop: 15,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#007AFF", // blue button
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF", // always white
  },

  modeSwitch: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingVertical: 12,
    backgroundColor: "#E9ECEF",
  },
  modeButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ADB5BD",
    backgroundColor: "#FFFFFF",
  },
  activeMode: {
    backgroundColor: "#007AFF", // blue when selected
    borderColor: "#007AFF",
  },
  modeText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },

  deviceCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  deviceTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000",
  },
  deviceRSSI: {
    marginTop: 4,
    fontSize: 15,
    color: "#444",
  },
  deviceStatus: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: "700",
  },
});

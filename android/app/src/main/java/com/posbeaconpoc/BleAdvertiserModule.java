package com.posbeaconpoc.ble;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class BleAdvertiserModule extends ReactContextBaseJavaModule {
    private static final String TAG = "BleAdvertiserModule";
    private BluetoothLeAdvertiser advertiser = null;
    private AdvertiseCallback advertiseCallback = null;
    private final ReactApplicationContext reactContext;

    public BleAdvertiserModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "BleAdvertiserModule";
    }

    @ReactMethod
    public void isAdvertisingSupported(Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.resolve(false);
                return;
            }
            boolean supported = adapter.isMultipleAdvertisementSupported();
            promise.resolve(supported);
        } catch (Exception e) {
            promise.reject("ERR", e.getMessage());
        }
    }

    @ReactMethod
    public void startAdvertising(String manufacturerDataBase64, Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                promise.reject("BT_OFF", "Bluetooth adapter null or disabled");
                return;
            }

            if (!adapter.isMultipleAdvertisementSupported()) {
                promise.reject("NOT_SUPPORTED", "Peripheral advertising not supported on this device");
                return;
            }

            advertiser = adapter.getBluetoothLeAdvertiser();
            if (advertiser == null) {
                promise.reject("NO_ADVERTISER", "BluetoothLeAdvertiser returned null");
                return;
            }

            byte[] manufacturerBytes = Base64.decode(manufacturerDataBase64, Base64.DEFAULT);
            // Build AdvertiseData with manufacturer data (company id 0xFFFF)
            AdvertiseData.Builder dataBuilder = new AdvertiseData.Builder();
            // manufacturerId (0xFFFF). The addManufacturerData takes an int and byte[].
            int manufacturerId = 0xFFFF;
            dataBuilder.addManufacturerData(manufacturerId, manufacturerBytes);

            // add a small service UUID so some scanners report service
            ParcelUuid puuid = new ParcelUuid(UUID.fromString("0000feed-0000-1000-8000-00805f9b34fb"));
            dataBuilder.addServiceUuid(puuid);

            AdvertiseData advertiseData = dataBuilder.build();

            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .setConnectable(false)
                    .build();

            advertiseCallback = new AdvertiseCallback() {
                @Override
                public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                    super.onStartSuccess(settingsInEffect);
                    Log.i(TAG, "Advertise started successfully");
                }

                @Override
                public void onStartFailure(int errorCode) {
                    super.onStartFailure(errorCode);
                    Log.e(TAG, "Advertise failed: " + errorCode);
                }
            };

            advertiser.startAdvertising(settings, advertiseData, advertiseCallback);

            // resolve promise quickly — the callback logs success/failure
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "startAdvertising error", e);
            promise.reject("ERR_START", e.getMessage());
        }
    }

    @ReactMethod
    public void stopAdvertising(Promise promise) {
        try {
            if (advertiser != null && advertiseCallback != null) {
                advertiser.stopAdvertising(advertiseCallback);
                advertiseCallback = null;
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERR_STOP", e.getMessage());
        }
    }
}

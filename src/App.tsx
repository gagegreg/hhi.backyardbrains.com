// src/App.tsx
import { useState, useEffect } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  Button,
  Select,
  MenuItem,
  TextField,
  FormControl,
  InputLabel,
  IconButton,
  Snackbar,
  Alert,
  Checkbox,
  FormGroup,
  FormControlLabel,
} from "@mui/material";
import BluetoothSearchingIcon from "@mui/icons-material/BluetoothSearching";

// ================= BLE UUID DEFINITIONS =================
const BATTERY_SERVICE_UUID = 0x180f;
const BATTERY_LEVEL_CHAR_UUID = 0x2a19;
const HHI_SERVICE_UUID = 0xbb01;

const UUIDs = {
  operatingMode:        0xbb02,
  stimAmplitude:        0xbb03, // UInt16 0–50 mA | 0xFFFF = POT
  stimFrequency:        0xbb04, // UInt8  1–100 Hz
  stimPulseWidth:       0xbb05, // UInt16 50–1000 µs
  stimDuration:         0xbb06, // UInt8  0–50×100 ms | 0xFF while>thr
  emgThreshold:         0xbb07, // UInt8  0–5
  mqttServerPort:       0xbb09,
  masterNameAddr:       0xbb0a,
  minionNameAddr:       0xbb0b,
  wifiSSID:             0xbb0c,
  wifiPassword:         0xbb0d,
  wifiStatus:           0xbb0e,
  wifiIP:               0xbb0f,
  currentStimAmplitude: 0xbb10, // RO mirror, UInt16, notifies
  triggerEnableMask:    0xbb11, // UInt8  bit0=EMG bit1=Button
  triggerStimulation:   0xbb12, // UInt8  0|1
  stimNumPulses:        0xbb13, // UInt16 0–65535 (0 = ∞)
} as const;

// ================= Utility helpers =================
const toUint8      = (n: number) => new Uint8Array([n & 0xff]);
const toUint16LE   = (n: number) => {
  const b = new ArrayBuffer(2);
  new DataView(b).setUint16(0, n, true);
  return new Uint8Array(b);
};
const fromUint8      = (dv: DataView) => dv.getUint8(0);
const fromUint16LE   = (dv: DataView) => dv.getUint16(0, true);
const decodeStr      = (dv: DataView) => new TextDecoder().decode(dv.buffer);
const encodeStr      = (s: string) => new TextEncoder().encode(s);
const writeStr       = (c: BluetoothRemoteGATTCharacteristic, s: string) => c.writeValue(encodeStr(s));

// ====================================================
function App() {
  // ---------- BLE handles ----------
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [hhiSvc, setHhiSvc] = useState<BluetoothRemoteGATTService | null>(null);

  // ---------- Config ----------
  const [operatingMode,   setOperatingMode]   = useState(0);
  const [stimAmplitude,   setStimAmplitude]   = useState(0);
  const [stimFrequency,   setStimFrequency]   = useState(20);
  const [stimPulseWidth,  setStimPulseWidth]  = useState(200);
  const [stimDuration,    setStimDuration]    = useState(1);
  const [stimNumPulses,   setStimNumPulses]   = useState(0);
  const [triggerMask,     setTriggerMask]     = useState(0);
  const [emgThreshold,    setEmgThreshold]    = useState(0);

  // ---------- Status ----------
  const [battery,         setBattery]         = useState(0);
  const [wifiConnected,   setWifiConnected]   = useState(false);
  const [mqttConnected,   setMqttConnected]   = useState(false);
  const [wifiIP,          setWifiIP]          = useState("");

  // ---------- Wi-Fi / MQTT creds ----------
  const [wifiSSID,        setWifiSSID]        = useState("");
  const [wifiPassword,    setWifiPassword]    = useState("");
  const [mqttServerPort,  setMqttServerPort]  = useState("");
  const [masterNameAddr,  setMasterNameAddr]  = useState("");
  const [minionNameAddr,  setMinionNameAddr]  = useState("");

  // ---------- UI helpers ----------
  const [logLines,  setLogLines]  = useState<string[]>([]);
  const [snackbar,  setSnackbar]  = useState({ open: false, msg: "" });
  const log   = (m: string) => setLogLines(p => [...p, m]);
  const toast = (msg: string) => {
    setSnackbar({ open: true, msg });
    setTimeout(() => setSnackbar({ open: false, msg: "" }), 1500);
  };

  // --------------- Handle Disconnect -----------------
  const onDisconnected = () => {
    log("Device disconnected.");
    toast("Device disconnected 🔌");
    setDevice(null);
    setHhiSvc(null);
    // Reset connection-related status states
    setBattery(0); // Assuming battery info is unavailable when disconnected
    setWifiConnected(false);
    setMqttConnected(false);
    setWifiIP("");
    // Consider if other config states should be reset or preserved
  };

  // --------------- Connect ---------------
  const onConnect = async () => {
    try {
      log("Requesting BLE device…");
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BATTERY_SERVICE_UUID, HHI_SERVICE_UUID],
      });
      setDevice(dev);

      // Add disconnect listener
      dev.addEventListener('gattserverdisconnected', onDisconnected);

      log("Connecting GATT…");
      const gatt = await dev.gatt!.connect();

      // -------- Battery first --------
      try {
        const batSvc  = await gatt.getPrimaryService(BATTERY_SERVICE_UUID);
        const batChar = await batSvc.getCharacteristic(BATTERY_LEVEL_CHAR_UUID);
        setBattery(fromUint8(await batChar.readValue()));
        await batChar.startNotifications();
        batChar.addEventListener("characteristicvaluechanged", e =>
          setBattery(fromUint8((e.target as BluetoothRemoteGATTCharacteristic).value!))
        );
      } catch (e) {
        log(`Battery svc err: ${e}`);
      }

      // -------- HHI service --------
      const service = await gatt.getPrimaryService(HHI_SERVICE_UUID);
      setHhiSvc(service);
      await readInitial(service);
      await startNotifications(service);   // all 0xBBxx notifications here (after battery)
      toast("Connected ✅");
    } catch (e) {
      console.error(e);
      toast("Connection failed");
    }
  };

  // --------------- Initial read ---------------
  const readInitial = async (svc: BluetoothRemoteGATTService) => {
    log("Starting initial parameter read...");

    // Helper for reading an 8-bit unsigned integer
    const readUint8 = async (uuid: number, setter: (value: number) => void, name: string) => {
      try {
        const char = await svc.getCharacteristic(uuid);
        const value = fromUint8(await char.readValue());
        setter(value);
        log(`${name} read: ${value}`);
      } catch (e) {
        log(`Failed to read ${name} (0x${uuid.toString(16)}): ${e}`);
      }
    };

    // Helper for reading a 16-bit unsigned little-endian integer
    const readUint16LE = async (uuid: number, setter: (value: number) => void, name: string) => {
      try {
        const char = await svc.getCharacteristic(uuid);
        const value = fromUint16LE(await char.readValue());
        setter(value);
        log(`${name} read: ${value}`);
      } catch (e) {
        log(`Failed to read ${name} (0x${uuid.toString(16)}): ${e}`);
      }
    };

    // Helper for reading a string
    const readString = async (uuid: number, setter: (value: string) => void, name: string) => {
      try {
        const char = await svc.getCharacteristic(uuid);
        const value = decodeStr(await char.readValue());
        setter(value);
        log(`${name} read: '${value}'`);
      } catch (e) {
        log(`Failed to read ${name} (0x${uuid.toString(16)}): ${e}`);
      }
    };

    // 1. Read Operating Mode first
    await readUint8(UUIDs.operatingMode, setOperatingMode, "Operating Mode");

    // 2. Read general stimulation parameters
    await readUint16LE(UUIDs.stimAmplitude, setStimAmplitude, "Stim Amplitude"); // 16-bit
    await readUint8(UUIDs.emgThreshold, setEmgThreshold, "EMG Threshold");

    // 3. Read Network Parameters
    try {
      const char = await svc.getCharacteristic(UUIDs.wifiStatus);
      const ws = fromUint8(await char.readValue());
      setWifiConnected(!!(ws & 0x01));
      setMqttConnected(!!(ws & 0x02));
      log(`WiFi Status read: Connected=${!!(ws & 0x01)}, MQTT Connected=${!!(ws & 0x02)}`);
    } catch (e) {
      log(`Failed to read WiFi Status (0x${UUIDs.wifiStatus.toString(16)}): ${e}`);
    }
    await readString(UUIDs.wifiIP, setWifiIP, "WiFi IP");
    await readString(UUIDs.wifiSSID, setWifiSSID, "WiFi SSID");
    await readString(UUIDs.mqttServerPort, setMqttServerPort, "MQTT Server/Port");
    await readString(UUIDs.masterNameAddr, setMasterNameAddr, "Master Name/Addr");
    await readString(UUIDs.minionNameAddr, setMinionNameAddr, "Minion Name/Addr");

    // 4. Read other stimulation parameters (potentially Mode 3 specific) at the end
    log("Attempting to read Mode 3-centric stimulation parameters (these may fail in other modes)...");
    await readUint8(UUIDs.stimFrequency, setStimFrequency, "Stim Frequency");
    await readUint16LE(UUIDs.stimPulseWidth, setStimPulseWidth, "Stim Pulse Width");
    await readUint8(UUIDs.stimDuration, setStimDuration, "Stim Duration");
    await readUint16LE(UUIDs.stimNumPulses, setStimNumPulses, "Stim Num Pulses");
    await readUint8(UUIDs.triggerEnableMask, setTriggerMask, "Trigger Enable Mask");

    log("Initial read sequence finished.");
  };

  // --------------- Notifications ---------------
  // ---------- Notifications ----------
  const startNotifications = async (svc: BluetoothRemoteGATTService) => {
    // helper to keep code DRY
    const subscribe = async (
      uuid: number,
      handler: (dv: DataView) => void,
    ) => {
      try {
        const ch = await svc.getCharacteristic(uuid);
        await ch.startNotifications();
        ch.addEventListener(
          "characteristicvaluechanged",
          (e) => handler((e.target as BluetoothRemoteGATTCharacteristic).value!),
        );
      } catch {
        // characteristic may be absent in older firmware – ignore
      }
    };

    // ----- 0xBB0E – Wi-Fi / MQTT status (bit-mask) -----
    await subscribe(UUIDs.wifiStatus, (dv) => {
      const v = fromUint8(dv);
      setWifiConnected(!!(v & 0x01));
      setMqttConnected(!!(v & 0x02));
    });

    // ----- 0xBB0F – IP address (string) -----
    await subscribe(UUIDs.wifiIP, (dv) => setWifiIP(decodeStr(dv)));

    // ----- 0xBB10 – current stimulation amplitude (UInt16 mirror) -----
    await subscribe(UUIDs.currentStimAmplitude, (dv) =>
      setStimAmplitude(fromUint16LE(dv)),
    );

    // ----- 0xBB07 – EMG threshold (UInt8) -----
    await subscribe(UUIDs.emgThreshold, (dv) =>
      setEmgThreshold(fromUint8(dv)),
    );

    // ----- 0xBB12 – stimulation trigger flag (UInt8 0|1) -----
    await subscribe(UUIDs.triggerStimulation, (dv) => {
      const on = !!fromUint8(dv);
      log(on ? "Stim started (remote)" : "Stim stopped (remote)");
    });
  };

  // Helper to refresh network-related fields when entering network modes
  const readNetworkSettings = async () => {
    if (!hhiSvc) return;

    const readString = async (uuid: number, setter: (value: string) => void, name: string) => {
      try {
        const c = await hhiSvc.getCharacteristic(uuid);
        const v = decodeStr(await c.readValue());
        setter(v);
        log(`${name} read: '${v}'`);
      } catch (e) {
        log(`Failed to read ${name} (0x${uuid.toString(16)}): ${e}`);
      }
    };

    await readString(UUIDs.wifiSSID, setWifiSSID, "WiFi SSID");
    await readString(UUIDs.mqttServerPort, setMqttServerPort, "MQTT Server/Port");
    await readString(UUIDs.masterNameAddr, setMasterNameAddr, "Master Name/Addr");
    await readString(UUIDs.minionNameAddr, setMinionNameAddr, "Minion Name/Addr");
  };

  useEffect(() => {
    if (operatingMode === 1 || operatingMode === 2) {
      void readNetworkSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatingMode, hhiSvc]);

  // --------------- Writers ---------------
  const saveOperatingMode = async () => {
    if (!hhiSvc) return;
    await (await hhiSvc.getCharacteristic(UUIDs.operatingMode))
      .writeValue(toUint8(operatingMode));
    toast("Mode saved");
  };

  const saveStimSettings = async () => {
    if (!hhiSvc) return;
    const w8  = (u: number, v: number) => hhiSvc.getCharacteristic(u).then(c => c.writeValue(toUint8(v)));
    const w16 = (u: number, v: number) => hhiSvc.getCharacteristic(u).then(c => c.writeValue(toUint16LE(v)));

    await w16(UUIDs.stimAmplitude,   stimAmplitude); // 16-bit now
    await w8 (UUIDs.stimFrequency,   stimFrequency);
    await w16(UUIDs.stimPulseWidth,  stimPulseWidth);
    await w8 (UUIDs.stimDuration,    stimDuration).catch(() => {});
    await w16(UUIDs.stimNumPulses,   stimNumPulses);
    await w8 (UUIDs.emgThreshold,    emgThreshold);
    await w8 (UUIDs.triggerEnableMask, triggerMask).catch(() => {});
    toast("Stimulation parameters saved");
  };

  const saveNetworkSettings = async () => {
    if (!hhiSvc) return;
    // Log the values being prepared to write
    log(`Saving network settings. SSID: '${wifiSSID}', Pass_Provided: ${!!wifiPassword}, MQTT: '${mqttServerPort}', Master: '${masterNameAddr}', Minion: '${minionNameAddr}'`);
    try {
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.wifiSSID), wifiSSID);
      if (wifiPassword) { // Only write password if a new one is provided
        log(`Writing WiFi Password (as it's not blank).`);
        await writeStr(await hhiSvc.getCharacteristic(UUIDs.wifiPassword), wifiPassword);
      }
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.mqttServerPort), mqttServerPort);
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.masterNameAddr), masterNameAddr);
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.minionNameAddr), minionNameAddr);
      toast("Network settings saved");
    } catch (e) {
      log(`Error saving network settings: ${e}`);
      toast("Save failed");
    }
  };

  const triggerStim = async (on: boolean) => {
    if (!hhiSvc) return;
    await (await hhiSvc.getCharacteristic(UUIDs.triggerStimulation))
      .writeValue(toUint8(on ? 1 : 0));
    toast(on ? "Stim start" : "Stim stop");
  };

  // ================= RENDER =================
  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography sx={{ flexGrow: 1 }} variant="h6">
            HHI BLE Configurator
          </Typography>
          {!device && (
            <IconButton color="inherit" onClick={onConnect}>
              <BluetoothSearchingIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="md">
        <Box mt={4}>
          {device ? (
            <>
              <Typography variant="h5">
                Device: {device.name || "Unknown"}
              </Typography>
              <Typography>Battery: {battery}%</Typography>
              <Typography>
                Wi-Fi: {wifiConnected ? "Connected" : "Disconnected"} · MQTT:{" "}
                {mqttConnected ? "Connected" : "Disconnected"}
              </Typography>
              <Typography>IP: {wifiIP || "—"}</Typography>

              {/* MODE SELECT */}
              <Box mt={3}>
                <FormControl fullWidth>
                  <InputLabel id="mode-label">Operating Mode</InputLabel>
                  <Select
                    labelId="mode-label"
                    label="Operating Mode"
                    value={operatingMode}
                    onChange={e => setOperatingMode(+e.target.value)}
                  >
                    <MenuItem value={0}>0 – Traditional HHI</MenuItem>
                    <MenuItem value={1}>1 – Remote Controller</MenuItem>
                    <MenuItem value={2}>2 – Remote Minion</MenuItem>
                    <MenuItem value={3}>3 – Custom</MenuItem>
                  </Select>
                </FormControl>
                <Button sx={{ mt: 1 }} variant="contained" onClick={saveOperatingMode}>
                  Save Mode
                </Button>
              </Box>

              {/* CUSTOM STIM UI */}
              {operatingMode === 3 && (
                <Box mt={4}>
                  <Typography variant="h6">Custom Stimulation</Typography>
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="Amplitude (mA 0-50, 0xFFFF=POT)"
                    value={stimAmplitude}
                    onChange={e => setStimAmplitude(+e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="Frequency (Hz 1-100)"
                    value={stimFrequency}
                    onChange={e => setStimFrequency(+e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="Pulse Width (µs 50-1000)"
                    value={stimPulseWidth}
                    onChange={e => setStimPulseWidth(+e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="Duration (0-50×100 ms, 255=while>thr)"
                    value={stimDuration}
                    onChange={e => setStimDuration(+e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="# Pulses (0 = ∞)"
                    value={stimNumPulses}
                    onChange={e => setStimNumPulses(+e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    type="number"
                    label="EMG Threshold (0-5)"
                    value={emgThreshold}
                    onChange={e => setEmgThreshold(+e.target.value)}
                  />

                  {/* Trigger mask as dual checkboxes */}
                  <FormGroup row sx={{ mt: 2 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!(triggerMask & 0x01)}
                          onChange={e =>
                            setTriggerMask(
                              (e.target.checked ? 1 : 0) | (triggerMask & 0x02),
                            )
                          }
                        />
                      }
                      label="EMG threshold"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!(triggerMask & 0x02)}
                          onChange={e =>
                            setTriggerMask(
                              (e.target.checked ? 2 : 0) | (triggerMask & 0x01),
                            )
                          }
                        />
                      }
                      label="Button press"
                    />
                  </FormGroup>

                  <Button variant="contained" sx={{ mt: 2 }} onClick={saveStimSettings}>
                    Save Parameters
                  </Button>

                  <Box mt={3}>
                    <Button
                      variant="contained"
                      color="secondary"
                      sx={{ mr: 2 }}
                      onClick={() => triggerStim(true)}
                    >
                      Start Stim
                    </Button>
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={() => triggerStim(false)}
                    >
                      Stop Stim
                    </Button>
                  </Box>
                </Box>
              )}

              {/* NETWORK CONFIG */}
              {(operatingMode === 1 || operatingMode === 2) && (
                <Box mt={4}>
                  <Typography variant="h6">Wi-Fi + MQTT</Typography>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Wi-Fi SSID"
                    value={wifiSSID}
                    onChange={e => setWifiSSID(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Wi-Fi Password"
                    type="password"
                    value={wifiPassword}
                    onChange={e => setWifiPassword(e.target.value)}
                    helperText="Leave blank to keep current password"
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="MQTT server/port"
                    value={mqttServerPort}
                    onChange={e => setMqttServerPort(e.target.value)}
                    helperText="mqtt://host:port"
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Master Name"
                    value={masterNameAddr}
                    onChange={e => setMasterNameAddr(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Minion Name"
                    value={minionNameAddr}
                    onChange={e => setMinionNameAddr(e.target.value)}
                  />
                  <Button variant="contained" sx={{ mt: 1 }} onClick={saveNetworkSettings}>
                    Save Network
                  </Button>
                </Box>
              )}
            </>
          ) : (
            <Box textAlign="center">
              <Typography variant="h5" gutterBottom>
                Please connect to HHI
              </Typography>
              <Button
                variant="contained"
                startIcon={<BluetoothSearchingIcon />}
                onClick={onConnect}
              >
                Connect
              </Button>
            </Box>
          )}
        </Box>

        {/* DEBUG LOG */}
        <Box mt={4} p={2} sx={{ bgcolor: "#f5f5f5", maxHeight: 300, overflowY: "auto" }}>
          <Typography variant="h6">Debug</Typography>
          <Button size="small" onClick={() => setLogLines([])}>
            Clear
          </Button>
          {logLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </Box>
      </Container>

      <Snackbar
        open={snackbar.open}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" sx={{ width: "100%" }}>
          {snackbar.msg}
        </Alert>
      </Snackbar>
    </>
  );
}

export default App;
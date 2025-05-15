// src/App.tsx
import { useState } from "react";
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

  // --------------- Connect ---------------
  const onConnect = async () => {
    try {
      log("Requesting BLE device…");
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BATTERY_SERVICE_UUID, HHI_SERVICE_UUID],
      });
      setDevice(dev);

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
    const r8  = async (u: number, s: (v: number) => void) =>
      s(fromUint8(await (await svc.getCharacteristic(u)).readValue()));
    const r16 = async (u: number, s: (v: number) => void) =>
      s(fromUint16LE(await (await svc.getCharacteristic(u)).readValue()));

    try {
      await r8 (UUIDs.operatingMode,   setOperatingMode);
      await r16(UUIDs.stimAmplitude,   setStimAmplitude);   // 16-bit now
      await r8 (UUIDs.stimFrequency,   setStimFrequency);
      await r16(UUIDs.stimPulseWidth,  setStimPulseWidth);
      try { await r8 (UUIDs.stimDuration, setStimDuration); } catch {}
      await r16(UUIDs.stimNumPulses,   setStimNumPulses);
      await r8 (UUIDs.emgThreshold,    setEmgThreshold);
      try { await r8 (UUIDs.triggerEnableMask, setTriggerMask); } catch {}

      const ws = fromUint8(await (await svc.getCharacteristic(UUIDs.wifiStatus)).readValue());
      setWifiConnected(!!(ws & 0x01));
      setMqttConnected(!!(ws & 0x02));

      setWifiIP(decodeStr(await (await svc.getCharacteristic(UUIDs.wifiIP)).readValue()));
      try { setWifiSSID       (decodeStr(await (await svc.getCharacteristic(UUIDs.wifiSSID)).readValue()));        } catch {}
      try { setMqttServerPort (decodeStr(await (await svc.getCharacteristic(UUIDs.mqttServerPort)).readValue()));   } catch {}
      try { setMasterNameAddr (decodeStr(await (await svc.getCharacteristic(UUIDs.masterNameAddr)).readValue()));   } catch {}
      try { setMinionNameAddr (decodeStr(await (await svc.getCharacteristic(UUIDs.minionNameAddr)).readValue()));   } catch {}
    } catch (e) {
      log(`Init read err: ${e}`);
    }
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
    try {
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.wifiSSID), wifiSSID);
      if (wifiPassword)
        await writeStr(await hhiSvc.getCharacteristic(UUIDs.wifiPassword), wifiPassword);
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.mqttServerPort), mqttServerPort);
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.masterNameAddr), masterNameAddr);
      await writeStr(await hhiSvc.getCharacteristic(UUIDs.minionNameAddr), minionNameAddr);
      toast("Network settings saved");
    } catch {
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
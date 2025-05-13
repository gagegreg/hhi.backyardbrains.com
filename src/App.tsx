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
} from "@mui/material";
import BluetoothSearchingIcon from "@mui/icons-material/BluetoothSearching";

// ================= BLE UUID DEFINITIONS ================= //
// Standard Battery Service/Characteristic UUIDs
const BATTERY_SERVICE_UUID = 0x180f;
const BATTERY_LEVEL_CHAR_UUID = 0x2a19;

// Custom Backyard Brains HHI Service UUID
const HHI_SERVICE_UUID = 0xbb01;

/**
 * Characteristic UUID mapping (16-bit).
 * 2025-05-13 spec refresh:
 *  • Added stimulationDuration (0xBB06)
 *  • Added triggerEnableMask  (0xBB11)
 *  • Removed “currentEmgThreshold” alias on 0xBB11
 */
const UUIDs = {
  operatingMode: 0xbb02,
  stimAmplitude: 0xbb03,
  stimFrequency: 0xbb04,
  stimPulseWidth: 0xbb05,
  stimDuration: 0xbb06,
  emgThreshold: 0xbb07,
  mqttServerPort: 0xbb09,
  masterNameAddr: 0xbb0a,
  minionNameAddr: 0xbb0b,
  wifiSSID: 0xbb0c,
  wifiPassword: 0xbb0d,
  wifiStatus: 0xbb0e,
  wifiIP: 0xbb0f,
  currentStimAmplitude: 0xbb10, // read-only mirror of pot/manual
  triggerEnableMask: 0xbb11,
  triggerStimulation: 0xbb12,
  stimNumPulses: 0xbb13,
} as const;

// ================= Utility helpers ================= //
const toUint8 = (num: number) => new Uint8Array([num & 0xff]);
const toUint16LE = (num: number) => {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setUint16(0, num, /*littleEndian*/ true);
  return new Uint8Array(buf);
};
const fromUint8 = (dv: DataView) => dv.getUint8(0);
const fromUint16LE = (dv: DataView) => dv.getUint16(0, true);

const decodeString = (dv: DataView) => new TextDecoder().decode(dv.buffer);
const encodeString = (str: string) => new TextEncoder().encode(str);

async function writeString(
  characteristic: BluetoothRemoteGATTCharacteristic,
  str: string,
) {
  await characteristic.writeValue(encodeString(str));
}

// ==================================================== //
function App() {
  // ---------- BLE handles ---------- //
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [hhiService, setHhiService] = useState<BluetoothRemoteGATTService | null>(null);

  // ---------- Config states ---------- //
  const [operatingMode, setOperatingMode] = useState(0);

  // Stimulation (mode 3)
  const [stimAmplitude, setStimAmplitude] = useState(0);      // 0-500, 65535=pot
  const [stimFrequency, setStimFrequency] = useState(20);     // 1-100 Hz
  const [stimPulseWidth, setStimPulseWidth] = useState(200);  // µs 50-1000
  const [stimDuration, setStimDuration] = useState(1);        // 0-50 (×100 ms) | 255
  const [stimNumPulses, setStimNumPulses] = useState(0);      // 0-65535
  const [triggerMask,  setTriggerMask]  = useState(0);        // 0-3
  const [emgThreshold, setEmgThreshold] = useState(0);        // 0-5

  // Status
  const [batteryLevel,  setBatteryLevel]  = useState(0);
  const [wifiConnected, setWifiConnected] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [wifiIP,        setWifiIP]        = useState("");

  // Wi-Fi / MQTT creds
  const [wifiSSID,        setWifiSSID]        = useState("");
  const [wifiPassword,    setWifiPassword]    = useState("");
  const [mqttServerPort,  setMqttServerPort]  = useState("");
  const [masterNameAddr,  setMasterNameAddr]  = useState("");
  const [minionNameAddr,  setMinionNameAddr]  = useState("");

  // UI helpers
  const [logLines,  setLogLines]  = useState<string[]>([]);
  const [snackbar,  setSnackbar]  = useState<{open:boolean,msg:string}>({open:false,msg:""});

  const log = (m: string) => setLogLines(prev => [...prev, m]);
  const toast = (msg: string) => {
    setSnackbar({open:true,msg});
    setTimeout(()=>setSnackbar({open:false,msg:""}), 1200);
  };

  // --------------- Connect --------------- //
  const onConnect = async () => {
    try {
      log("Requesting BLE device…");
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices:true,
        optionalServices:[BATTERY_SERVICE_UUID, HHI_SERVICE_UUID]
      });
      setDevice(dev);
      log("Connecting GATT…");
      const gatt = await dev.gatt!.connect();

      // Battery
      try {
        const batSvc = await gatt.getPrimaryService(BATTERY_SERVICE_UUID);
        const batChar = await batSvc.getCharacteristic(BATTERY_LEVEL_CHAR_UUID);
        const init = fromUint8(await batChar.readValue());
        setBatteryLevel(init);
        batChar.startNotifications();
        batChar.addEventListener("characteristicvaluechanged", ev => {
          const val = fromUint8((ev.target as BluetoothRemoteGATTCharacteristic).value!);
          setBatteryLevel(val);
        });
      } catch(e) { log(`Battery svc err: ${e}`); }

      // HHI service
      const svc = await gatt.getPrimaryService(HHI_SERVICE_UUID);
      setHhiService(svc);
      await readInitial(svc);
      await startNotifications(svc);
      toast("Connected ✅");
    } catch(e) {
      console.error(e);
      toast("Connection failed");
    }
  };

  // --------------- Initial read --------------- //
  const readInitial = async (svc: BluetoothRemoteGATTService) => {
    try {
      const read8  = async (uuid:number,set:(n:number)=>void) => set(fromUint8(await (await svc.getCharacteristic(uuid)).readValue()));
      const read16 = async (uuid:number,set:(n:number)=>void) => set(fromUint16LE(await (await svc.getCharacteristic(uuid)).readValue()));

      await read8(UUIDs.operatingMode, setOperatingMode);
      await read16(UUIDs.stimAmplitude, setStimAmplitude);
      await read8(UUIDs.stimFrequency, setStimFrequency);
      await read16(UUIDs.stimPulseWidth, setStimPulseWidth);
      await read8(UUIDs.stimDuration, setStimDuration);
      await read16(UUIDs.stimNumPulses, setStimNumPulses);
      await read8(UUIDs.emgThreshold,  setEmgThreshold);
      await read8(UUIDs.triggerEnableMask, setTriggerMask);

      // Wi-Fi status byte
      const ws = fromUint8(await (await svc.getCharacteristic(UUIDs.wifiStatus)).readValue());
      setWifiConnected(!!(ws & 0x01));
      setMqttConnected(!!(ws & 0x02));

      // IP & SSID (optional read)
      setWifiIP(decodeString(await (await svc.getCharacteristic(UUIDs.wifiIP)).readValue()));
      try { setWifiSSID(decodeString(await (await svc.getCharacteristic(UUIDs.wifiSSID)).readValue())); } catch{}
      try { setMqttServerPort(decodeString(await (await svc.getCharacteristic(UUIDs.mqttServerPort)).readValue())); } catch{}
      try { setMasterNameAddr(decodeString(await (await svc.getCharacteristic(UUIDs.masterNameAddr)).readValue())); } catch{}
      try { setMinionNameAddr(decodeString(await (await svc.getCharacteristic(UUIDs.minionNameAddr)).readValue())); } catch{}

    } catch(e){ log(`Init read err: ${e}`);}  };

  // --------------- Notifications --------------- //
  const startNotifications = async (svc: BluetoothRemoteGATTService) => {
    // Wi-Fi status
    try {
      const wsChar = await svc.getCharacteristic(UUIDs.wifiStatus);
      await wsChar.startNotifications();
      wsChar.addEventListener("characteristicvaluechanged", ev => {
        const v = fromUint8((ev.target as BluetoothRemoteGATTCharacteristic).value!);
        setWifiConnected(!!(v & 0x01));
        setMqttConnected(!!(v & 0x02));
      });
    }catch{}
    // IP
    try {
      const ipChar = await svc.getCharacteristic(UUIDs.wifiIP);
      await ipChar.startNotifications();
      ipChar.addEventListener("characteristicvaluechanged", ev => setWifiIP(decodeString((ev.target as BluetoothRemoteGATTCharacteristic).value!)));
    }catch{}
  };

  // --------------- Writers --------------- //
  const saveOperatingMode = async () => {
    if(!hhiService) return;
    await (await hhiService.getCharacteristic(UUIDs.operatingMode)).writeValue(toUint8(operatingMode));
    toast("Mode saved");
  };

  const saveStimSettings = async () => {
    if(!hhiService) return;
    const w8  = async (uuid:number,val:number) => (await hhiService.getCharacteristic(uuid)).writeValue(toUint8(val));
    const w16 = async (uuid:number,val:number)=> (await hhiService.getCharacteristic(uuid)).writeValue(toUint16LE(val));

    await w16(UUIDs.stimAmplitude,   stimAmplitude);
    await w8 (UUIDs.stimFrequency,   stimFrequency);
    await w16(UUIDs.stimPulseWidth,  stimPulseWidth);
    await w8 (UUIDs.stimDuration,    stimDuration);
    await w16(UUIDs.stimNumPulses,   stimNumPulses);
    await w8 (UUIDs.emgThreshold,    emgThreshold);
    await w8 (UUIDs.triggerEnableMask, triggerMask);
    toast("Stimulation parameters saved");
  };

  const saveNetworkSettings = async () => {
    if(!hhiService) return;
    try {
      await writeString(await hhiService.getCharacteristic(UUIDs.wifiSSID), wifiSSID);
      if(wifiPassword) await writeString(await hhiService.getCharacteristic(UUIDs.wifiPassword), wifiPassword);
      await writeString(await hhiService.getCharacteristic(UUIDs.mqttServerPort), mqttServerPort);
      await writeString(await hhiService.getCharacteristic(UUIDs.masterNameAddr), masterNameAddr);
      await writeString(await hhiService.getCharacteristic(UUIDs.minionNameAddr), minionNameAddr);
      toast("Network settings saved");
    }catch(e){ toast("Save failed"); }
  };

  const triggerStim = async (on:boolean) => {
    if(!hhiService) return;
    await (await hhiService.getCharacteristic(UUIDs.triggerStimulation)).writeValue(toUint8(on?1:0));
    toast(on?"Stim start":"Stim stop");
  };

  // ================= RENDER ================= //
  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{flexGrow:1}}>HHI BLE Configurator</Typography>
          {!device && (
            <IconButton color="inherit" onClick={onConnect}><BluetoothSearchingIcon/></IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="md">
        <Box mt={4}>
          {device? (
            <>
              <Typography variant="h5">Device: {device.name||"Unknown"}</Typography>
              <Typography>Battery: {batteryLevel}%</Typography>
              <Typography>Wi-Fi: {wifiConnected?"Connected":"Disconnected"} · MQTT: {mqttConnected?"Connected":"Disconnected"}</Typography>
              <Typography>IP: {wifiIP||"—"}</Typography>

              {/* MODE SELECT */}
              <Box mt={3}>
                <FormControl fullWidth>
                  <InputLabel id="mode-label">Operating Mode</InputLabel>
                  <Select labelId="mode-label" value={operatingMode} label="Operating Mode" onChange={e=>setOperatingMode(+e.target.value)}>
                    <MenuItem value={0}>0 – Traditional HHI</MenuItem>
                    <MenuItem value={1}>1 – Remote Controller</MenuItem>
                    <MenuItem value={2}>2 – Remote Minion</MenuItem>
                    <MenuItem value={3}>3 – Custom</MenuItem>
                  </Select>
                </FormControl>
                <Button sx={{mt:1}} variant="contained" onClick={saveOperatingMode}>Save Mode</Button>
              </Box>

              {/* CUSTOM STIM UI */}
              {operatingMode===3 && (
                <Box mt={4}>
                  <Typography variant="h6">Custom Stimulation</Typography>
                  <TextField fullWidth margin="normal" type="number" label="Amplitude (0-500 => 0-50 mA, 65535=p-pot)" value={stimAmplitude} onChange={e=>setStimAmplitude(+e.target.value)}/>
                  <TextField fullWidth margin="normal" type="number" label="Frequency (Hz 1-100)" value={stimFrequency} onChange={e=>setStimFrequency(+e.target.value)}/>
                  <TextField fullWidth margin="normal" type="number" label="Pulse Width (µs 50-1000)" value={stimPulseWidth} onChange={e=>setStimPulseWidth(+e.target.value)}/>
                  <TextField fullWidth margin="normal" type="number" label="Duration (0-50 ×100 ms, 255=while>thr)" value={stimDuration} onChange={e=>setStimDuration(+e.target.value)}/>
                  <TextField fullWidth margin="normal" type="number" label="# Pulses (0=∞)" value={stimNumPulses} onChange={e=>setStimNumPulses(+e.target.value)}/>
                  <TextField fullWidth margin="normal" type="number" label="EMG Threshold (0-5)" value={emgThreshold} onChange={e=>setEmgThreshold(+e.target.value)}/>
                  <FormControl fullWidth margin="normal">
                    <InputLabel id="trig-label">Trigger Enable Mask</InputLabel>
                    <Select labelId="trig-label" value={triggerMask} label="Trigger Enable Mask" onChange={e=>setTriggerMask(+e.target.value)}>
                      <MenuItem value={0}>0 – Disabled</MenuItem>
                      <MenuItem value={1}>1 – EMG only</MenuItem>
                      <MenuItem value={2}>2 – Button only</MenuItem>
                      <MenuItem value={3}>3 – EMG + Button</MenuItem>
                    </Select>
                  </FormControl>

                  <Button variant="contained" sx={{mt:2}} onClick={saveStimSettings}>Save Parameters</Button>

                  <Box mt={3}>
                    <Button variant="contained" color="secondary" sx={{mr:2}} onClick={()=>triggerStim(true)}>Start Stim</Button>
                    <Button variant="contained" color="warning" onClick={()=>triggerStim(false)}>Stop Stim</Button>
                  </Box>
                </Box>
              )}

              {/* NETWORK CONFIG */}
              {(operatingMode===1||operatingMode===2) && (
                <Box mt={4}>
                  <Typography variant="h6">Wi-Fi + MQTT</Typography>
                  <TextField fullWidth margin="normal" label="Wi-Fi SSID" value={wifiSSID} onChange={e=>setWifiSSID(e.target.value)}/>
                  <TextField fullWidth margin="normal" label="Wi-Fi Password" type="password" value={wifiPassword} onChange={e=>setWifiPassword(e.target.value)} helperText="Leave blank to keep current password"/>
                  <TextField fullWidth margin="normal" label="MQTT server/port" value={mqttServerPort} onChange={e=>setMqttServerPort(e.target.value)} helperText="mqtt://host:port"/>
                  <TextField fullWidth margin="normal" label="Master Name" value={masterNameAddr} onChange={e=>setMasterNameAddr(e.target.value)}/>
                  <TextField fullWidth margin="normal" label="Minion Name" value={minionNameAddr} onChange={e=>setMinionNameAddr(e.target.value)}/>
                  <Button variant="contained" sx={{mt:1}} onClick={saveNetworkSettings}>Save Network</Button>
                </Box>
              )}

            </>
          ) : (
            <Box textAlign="center">
              <Typography variant="h5" gutterBottom>Please connect to HHI</Typography>
              <Button variant="contained" startIcon={<BluetoothSearchingIcon/>} onClick={onConnect}>Connect</Button>
            </Box>
          )}
        </Box>

        {/* DEBUG LOG */}
        <Box mt={4} p={2} sx={{bgcolor:"#f5f5f5",maxHeight:300,overflowY:"auto"}}>
          <Typography variant="h6">Debug</Typography>
          <Button size="small" onClick={()=>setLogLines([])}>Clear</Button>
          {logLines.map((l,i)=><div key={i}>{l}</div>)}
        </Box>
      </Container>

      <Snackbar open={snackbar.open} anchorOrigin={{vertical:"bottom",horizontal:"center"}}>
        <Alert severity="info" sx={{width:"100%"}}>{snackbar.msg}</Alert>
      </Snackbar>
    </>
  );
}

export default App;

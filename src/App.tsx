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
} from "@mui/material";
import BluetoothSearchingIcon from "@mui/icons-material/BluetoothSearching";

// ----- BLE Service/Characteristic UUIDs ----- //
const HHI_SERVICE_UUID = 0xBB01;
const UUIDs = {
  operatingMode: 0xBB02,
  stimAmplitude: 0xBB03,
  stimFrequency: 0xBB04,
  stimPulseWidth: 0xBB05,
  // 0xBB06 is reserved
  emgThreshold: 0xBB07,
  batteryLevel: 0xBB08,      // R/Notify
  mqttServerPort: 0xBB09,   // R/W (UTF-8 string)
  masterNameAddr: 0xBB0A,   // R/W (UTF-8 string)
  minionNameAddr: 0xBB0B,   // R/W (UTF-8 string)
  wifiSSID: 0xBB0C,         // R/W (UTF-8 string)
  wifiPassword: 0xBB0D,     // Write Only (UTF-8 string)
  wifiStatus: 0xBB0E,       // R/Notify (8-bit integer with bitflags)
  wifiIP: 0xBB0F,           // R/Notify (UTF-8 string)
  currentStimAmplitude: 0xBB10, // R/Notify
  currentEmgThreshold: 0xBB11,  // R/Notify
  triggerStimulation: 0xBB12,   // W
  stimNumPulses: 0xBB13,
};

function toByteArray(num: number) {
  return new Uint8Array([num & 0xff]);
}
function fromDataView8(dataView: DataView): number {
  return dataView.getUint8(0);
}
/** Helper to read a UTF-8 string from a BLE characteristic value */
function decodeString(value: DataView) {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(value.buffer);
}
/** Helper to write a UTF-8 string */
async function writeString(
  characteristic: BluetoothRemoteGATTCharacteristic,
  str: string
) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  await characteristic.writeValue(data);
}

function App() {
  // -- Bluetooth states
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [hhiService, setHhiService] = useState<BluetoothRemoteGATTService | null>(null);

  // -- Some example UI states
  const [operatingMode, setOperatingMode] = useState<number>(0);
  const [stimAmplitude, setStimAmplitude] = useState<number>(10);
  const [stimFrequency, setStimFrequency] = useState<number>(20);
  const [stimPulseWidth, setStimPulseWidth] = useState<number>(200);
  const [stimNumPulses, setStimNumPulses] = useState<number>(5);

  const [batteryLevel, setBatteryLevel] = useState<number>(0);
  // This status is an 8-bit integer with bit 0 = Wi-Fi, bit 1 = MQTT, etc.
  // For a simple example, we'll interpret just bit 0 as wifiConnected.
  const [wifiConnected, setWifiConnected] = useState<boolean>(false);
  // Potentially track MQTT status bit as well
  const [mqttConnected, setMqttConnected] = useState<boolean>(false);

  const [wifiIP, setWifiIP] = useState<string>("");

  // New states from the spec
  const [emgThreshold, setEmgThreshold] = useState<number>(0);

  // Wi-Fi config
  const [wifiSSID, setWifiSSID] = useState<string>("");
  const [wifiPassword, setWifiPassword] = useState<string>(""); // Write-Only
  // MQTT
  const [mqttServerPort, setMqttServerPort] = useState<string>("");
  // Master/Minion
  const [masterNameAddr, setMasterNameAddr] = useState<string>("");
  const [minionNameAddr, setMinionNameAddr] = useState<string>("");

  /**
   * Click handler to discover the BLE device and connect.
   */
  const onConnectClick = async () => {
    try {
      // Request a device with the HHI Service
      const bleDevice = await navigator.bluetooth.requestDevice({
        //filters: [{ services: [HHI_SERVICE_UUID] }],
        acceptAllDevices: true,
        optionalServices: [HHI_SERVICE_UUID],
      });
      setDevice(bleDevice);

      // Connect to GATT Server
      const gattServer = await bleDevice.gatt!.connect();

      // Get HHI Service
      const service = await gattServer.getPrimaryService(HHI_SERVICE_UUID);
      setHhiService(service);

      // Read initial characteristics
      await readInitialCharacteristics(service);

      // Start notifications for battery, Wi-Fi status, IP
      await startNotifications(service);

      alert("Connected and ready!");
    } catch (err) {
      console.error("Connection error:", err);
      alert("Failed to connect to device. See console for details.");
    }
  };

  /**
   * Read initial values from relevant characteristics:
   * Operating Mode, Stimulation params, Battery, Wi-Fi, etc.
   */
  const readInitialCharacteristics = async (
    service: BluetoothRemoteGATTService
  ) => {
    try {
      // Operating Mode
      const modeChar = await service.getCharacteristic(UUIDs.operatingMode);
      const modeVal = await modeChar.readValue();
      setOperatingMode(fromDataView8(modeVal));

      // Amplitude
      const ampChar = await service.getCharacteristic(UUIDs.stimAmplitude);
      const ampVal = await ampChar.readValue();
      setStimAmplitude(fromDataView8(ampVal));

      // Frequency
      const freqChar = await service.getCharacteristic(UUIDs.stimFrequency);
      const freqVal = await freqChar.readValue();
      setStimFrequency(fromDataView8(freqVal));

      // Pulse Width: 16-bit. We read 2 bytes (little-endian).
      const pwChar = await service.getCharacteristic(UUIDs.stimPulseWidth);
      const pwVal = await pwChar.readValue();
      const pulseWidth = pwVal.getUint16(0, true);
      setStimPulseWidth(pulseWidth);

      // Number of pulses
      const numChar = await service.getCharacteristic(UUIDs.stimNumPulses);
      const numVal = await numChar.readValue();
      setStimNumPulses(fromDataView8(numVal));

      // Battery
      const battChar = await service.getCharacteristic(UUIDs.batteryLevel);
      const battVal = await battChar.readValue();
      setBatteryLevel(fromDataView8(battVal));

      // Wi-Fi Status
      const wsChar = await service.getCharacteristic(UUIDs.wifiStatus);
      const wsVal = await wsChar.readValue();
      const wifiStat = fromDataView8(wsVal);
      // bit 0 => wifi connected, bit 1 => mqtt connected
      setWifiConnected((wifiStat & 0x01) !== 0);
      setMqttConnected((wifiStat & 0x02) !== 0);

      // Wi-Fi IP
      const ipChar = await service.getCharacteristic(UUIDs.wifiIP);
      const ipVal = await ipChar.readValue();
      setWifiIP(decodeString(ipVal));

      // EMG Threshold
      try {
        const emgChar = await service.getCharacteristic(UUIDs.emgThreshold);
        const emgVal = await emgChar.readValue();
        setEmgThreshold(fromDataView8(emgVal));
      } catch (err) {
        console.warn("EMG threshold not available:", err);
      }

      // Wi-Fi SSID
      try {
        const ssidChar = await service.getCharacteristic(UUIDs.wifiSSID);
        const ssidVal = await ssidChar.readValue();
        setWifiSSID(decodeString(ssidVal));
      } catch (err) {
        console.warn("Wi-Fi SSID read not available:", err);
      }

      // Wi-Fi Password is Write-Only - Do not attempt read

      // MQTT server/port
      try {
        const mqttChar = await service.getCharacteristic(UUIDs.mqttServerPort);
        const mqttVal = await mqttChar.readValue();
        setMqttServerPort(decodeString(mqttVal));
      } catch (err) {
        console.warn("MQTT server/port read not available:", err);
      }

      // Master name/address
      try {
        const masterChar = await service.getCharacteristic(UUIDs.masterNameAddr);
        const masterVal = await masterChar.readValue();
        setMasterNameAddr(decodeString(masterVal));
      } catch (err) {
        console.warn("Master name read not available:", err);
      }

      // Minion name/address
      try {
        const minionChar = await service.getCharacteristic(UUIDs.minionNameAddr);
        const minionVal = await minionChar.readValue();
        setMinionNameAddr(decodeString(minionVal));
      } catch (err) {
        console.warn("Minion name read not available:", err);
      }
    } catch (err) {
      console.error("Error reading initial values:", err);
    }
  };

  /**
   * Start notifications for Battery, Wi-Fi Status, Wi-Fi IP
   */
  const startNotifications = async (service: BluetoothRemoteGATTService) => {
    // Battery
    try {
      const battChar = await service.getCharacteristic(UUIDs.batteryLevel);
      await battChar.startNotifications();
      battChar.addEventListener("characteristicvaluechanged", (event) => {
        const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        setBatteryLevel(fromDataView8(dv));
      });
    } catch (err) {
      console.warn("Battery notifications not available:", err);
    }

    // Wi-Fi Status
    try {
      const wsChar = await service.getCharacteristic(UUIDs.wifiStatus);
      await wsChar.startNotifications();
      wsChar.addEventListener("characteristicvaluechanged", (event) => {
        const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        const wifiStat = fromDataView8(dv);
        setWifiConnected((wifiStat & 0x01) !== 0);
        setMqttConnected((wifiStat & 0x02) !== 0);
      });
    } catch (err) {
      console.warn("Wi-Fi status notifications not available:", err);
    }

    // Wi-Fi IP
    try {
      const ipChar = await service.getCharacteristic(UUIDs.wifiIP);
      await ipChar.startNotifications();
      ipChar.addEventListener("characteristicvaluechanged", (event) => {
        const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        setWifiIP(decodeString(dv));
      });
    } catch (err) {
      console.warn("Wi-Fi IP notifications not available:", err);
    }
  };

  /**
   * Write the current UI settings to the device's stimulation-related characteristics
   */
  const onSaveStimulationSettings = async () => {
    if (!hhiService) return;
    try {
      // 1. Operating Mode
      const modeChar = await hhiService.getCharacteristic(UUIDs.operatingMode);
      await modeChar.writeValue(toByteArray(operatingMode));

      // 2. Stimulation Amplitude
      const ampChar = await hhiService.getCharacteristic(UUIDs.stimAmplitude);
      await ampChar.writeValue(toByteArray(stimAmplitude));

      // 3. Frequency
      const freqChar = await hhiService.getCharacteristic(UUIDs.stimFrequency);
      await freqChar.writeValue(toByteArray(stimFrequency));

      // 4. Pulse Width (16-bit)
      const pwChar = await hhiService.getCharacteristic(UUIDs.stimPulseWidth);
      const pwData = new Uint8Array(2);
      new DataView(pwData.buffer).setUint16(0, stimPulseWidth, true);
      await pwChar.writeValue(pwData);

      // 5. Num of Pulses
      const numChar = await hhiService.getCharacteristic(UUIDs.stimNumPulses);
      await numChar.writeValue(toByteArray(stimNumPulses));

      // 6. EMG Threshold (only if you want to write it)
      try {
        const emgChar = await hhiService.getCharacteristic(UUIDs.emgThreshold);
        await emgChar.writeValue(toByteArray(emgThreshold));
      } catch (err) {
        console.warn("Unable to write EMG threshold:", err);
      }

      alert("Stimulation Settings updated successfully.");
    } catch (err) {
      console.error("Error writing stimulation settings:", err);
      alert("Failed to write stimulation settings.");
    }
  };

  /**
   * Write the Wi-Fi, MQTT, Master/Minion settings
   */
  const onSaveWifiMqttSettings = async () => {
    if (!hhiService) return;
    try {
      // Wi-Fi SSID
      try {
        const ssidChar = await hhiService.getCharacteristic(UUIDs.wifiSSID);
        await writeString(ssidChar, wifiSSID);
      } catch (err) {
        console.warn("Failed to write Wi-Fi SSID:", err);
      }

      // Wi-Fi Password (write-only)
      // If user left it blank, do we skip? Typically you might skip so you don't overwrite.
      // For simplicity, if there's any value in wifiPassword, we attempt writing it.
      if (wifiPassword.trim().length > 0) {
        try {
          const pwdChar = await hhiService.getCharacteristic(UUIDs.wifiPassword);
          await writeString(pwdChar, wifiPassword);
        } catch (err) {
          console.warn("Failed to write Wi-Fi Password:", err);
        }
      }

      // MQTT server/port
      try {
        const mqttChar = await hhiService.getCharacteristic(UUIDs.mqttServerPort);
        await writeString(mqttChar, mqttServerPort);
      } catch (err) {
        console.warn("Failed to write MQTT server/port:", err);
      }

      // Master name/address
      try {
        const masterChar = await hhiService.getCharacteristic(UUIDs.masterNameAddr);
        await writeString(masterChar, masterNameAddr);
      } catch (err) {
        console.warn("Failed to write Master name/address:", err);
      }

      // Minion name/address
      try {
        const minionChar = await hhiService.getCharacteristic(UUIDs.minionNameAddr);
        await writeString(minionChar, minionNameAddr);
      } catch (err) {
        console.warn("Failed to write Minion name/address:", err);
      }

      alert("Wi-Fi/MQTT/Master/Minion settings updated successfully.");
    } catch (err) {
      console.error("Error writing Wi-Fi/MQTT settings:", err);
      alert("Failed to write Wi-Fi/MQTT settings.");
    }
  };

  /**
   * Trigger a single stimulation train in Mode 3
   */
  const onTriggerStimulation = async () => {
    if (!hhiService) return;
    try {
      const triggerChar = await hhiService.getCharacteristic(UUIDs.triggerStimulation);
      // Only need to write "1" (8-bit) to trigger
      await triggerChar.writeValue(toByteArray(1));
      alert("Stimulation triggered!");
    } catch (err) {
      console.error("Error triggering stimulation:", err);
      alert("Failed to trigger stimulation.");
    }
  };

  return (
    <>
      {/* Top AppBar */}
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            HHI BLE Configurator
          </Typography>
          {!device && (
            <IconButton color="inherit" onClick={onConnectClick}>
              <BluetoothSearchingIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="md">
        <Box mt={4}>
          {device ? (
            <>
              <Typography variant="h5" gutterBottom>
                Device: {device.name || "Unknown"}
              </Typography>
              <Typography>Battery: {batteryLevel}%</Typography>
              <Typography>
                Wi-Fi: {wifiConnected ? "Connected" : "Disconnected"}
                {", "}
                MQTT: {mqttConnected ? "Connected" : "Disconnected"}
              </Typography>
              <Typography>IP Address: {wifiIP}</Typography>

              <Box mt={2} mb={4}>
                {/* Operating Mode */}
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel id="mode-select-label">Operating Mode</InputLabel>
                  <Select
                    labelId="mode-select-label"
                    label="Operating Mode"
                    value={operatingMode}
                    onChange={(e) => setOperatingMode(Number(e.target.value))}
                  >
                    <MenuItem value={0}>Mode 0 - Default</MenuItem>
                    <MenuItem value={1}>Mode 1 - Remote Controller</MenuItem>
                    <MenuItem value={2}>Mode 2 - Remote Minion</MenuItem>
                    <MenuItem value={3}>Mode 3 - Custom</MenuItem>
                  </Select>
                </FormControl>

                {/* Stimulation Amplitude */}
                <TextField
                  fullWidth
                  margin="normal"
                  type="number"
                  label="Stimulation Amplitude (0-30, 255=pot)"
                  value={stimAmplitude}
                  onChange={(e) => setStimAmplitude(Number(e.target.value))}
                />

                {/* Stimulation Frequency */}
                <TextField
                  fullWidth
                  margin="normal"
                  type="number"
                  label="Stimulation Frequency (1-100 Hz)"
                  value={stimFrequency}
                  onChange={(e) => setStimFrequency(Number(e.target.value))}
                />

                {/* Stimulation Pulse Width */}
                <TextField
                  fullWidth
                  margin="normal"
                  type="number"
                  label="Stimulation Pulse Width (50-1000 µs)"
                  value={stimPulseWidth}
                  onChange={(e) => setStimPulseWidth(Number(e.target.value))}
                />

                {/* Number of Pulses */}
                <TextField
                  fullWidth
                  margin="normal"
                  type="number"
                  label="Number of Pulses (Mode 3)"
                  value={stimNumPulses}
                  onChange={(e) => setStimNumPulses(Number(e.target.value))}
                />

                {/* EMG Threshold */}
                <TextField
                  fullWidth
                  margin="normal"
                  type="number"
                  label="EMG Threshold (0-5, 255=button)"
                  value={emgThreshold}
                  onChange={(e) => setEmgThreshold(Number(e.target.value))}
                />

                <Button
                  variant="contained"
                  color="primary"
                  onClick={onSaveStimulationSettings}
                  sx={{ mt: 2 }}
                >
                  Save Stimulation Settings
                </Button>

                {/* Show "Trigger" button only if in Mode 3 */}
                {operatingMode === 3 && (
                  <Box mt={4}>
                    <Typography variant="h6">Trigger Custom Stimulation</Typography>
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={onTriggerStimulation}
                      sx={{ mt: 2 }}
                    >
                      Trigger Stimulation
                    </Button>
                  </Box>
                )}
              </Box>

              {/* If in Mode 1 or 2, show Wi-Fi config (or always show if you prefer) */}
              {(operatingMode === 1 || operatingMode === 2) && (
                <Box mt={2} mb={4}>
                  <Typography variant="h6">Wi-Fi and MQTT Settings</Typography>

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Wi-Fi SSID"
                    value={wifiSSID}
                    onChange={(e) => setWifiSSID(e.target.value)}
                  />

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Wi-Fi Password (write-only)"
                    type="password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    helperText="Leave blank if you do not wish to overwrite the current password."
                  />

                  <TextField
                    fullWidth
                    margin="normal"
                    label="MQTT Server/Port"
                    value={mqttServerPort}
                    onChange={(e) => setMqttServerPort(e.target.value)}
                    helperText='Example: "mqtt://8.tcp.eu.ngrok.io:22636"'
                  />

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Master Name/Address"
                    value={masterNameAddr}
                    onChange={(e) => setMasterNameAddr(e.target.value)}
                  />

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Minion Name/Address"
                    value={minionNameAddr}
                    onChange={(e) => setMinionNameAddr(e.target.value)}
                  />

                  <Button
                    variant="contained"
                    color="primary"
                    onClick={onSaveWifiMqttSettings}
                    sx={{ mt: 2 }}
                  >
                    Save Wi-Fi / MQTT / Master/Minion
                  </Button>
                </Box>
              )}
            </>
          ) : (
            // If not connected, show a button to connect
            <Box textAlign="center" mt={4}>
              <Typography variant="h5" gutterBottom>
                Please Connect to HHI
              </Typography>
              <Button
                variant="contained"
                startIcon={<BluetoothSearchingIcon />}
                onClick={onConnectClick}
              >
                Connect to HHI
              </Button>
            </Box>
          )}
        </Box>
      </Container>
    </>
  );
}

export default App;
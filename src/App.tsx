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
} from "@mui/material";
import BluetoothSearchingIcon from "@mui/icons-material/BluetoothSearching";

// ----- Standard Battery Service/Characteristic UUIDs ----- //
const BATTERY_SERVICE_UUID = 0x180f;
const BATTERY_LEVEL_CHAR_UUID = 0x2a19;

// ----- Our custom HHI Service/Characteristics (0xBB01, etc.) ----- //
const HHI_SERVICE_UUID = 0xbb01;

const UUIDs = {
  operatingMode: 0xbb02,
  stimAmplitude: 0xbb03,
  stimFrequency: 0xbb04,
  stimPulseWidth: 0xbb05,
  // 0xBB06 is 16-bit amplitude in your doc—if needed, add it similarly
  emgThreshold: 0xbb07,
  mqttServerPort: 0xbb09,
  masterNameAddr: 0xbb0a,
  minionNameAddr: 0xbb0b,
  wifiSSID: 0xbb0c,
  wifiPassword: 0xbb0d,
  wifiStatus: 0xbb0e,
  wifiIP: 0xbb0f,
  currentStimAmplitude: 0xbb10,
  currentEmgThreshold: 0xbb11,
  triggerStimulation: 0xbb12,
  stimNumPulses: 0xbb13,
};

// Helper to convert a number to a one-byte Uint8Array
function toByteArray(num: number) {
  return new Uint8Array([num & 0xff]);
}
// Helper to interpret a DataView as a single Uint8
function fromDataView8(dataView: DataView): number {
  return dataView.getUint8(0);
}
// Decode a DataView as a UTF-8 string
function decodeString(value: DataView) {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(value.buffer);
}
// Encode a string as UTF-8, and write to characteristic
async function writeString(
  characteristic: BluetoothRemoteGATTCharacteristic,
  str: string,
  useWithoutResponse = false
) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);

  // If your firmware expects Write Without Response on wifi password:
  if (useWithoutResponse) {
    await characteristic.writeValueWithoutResponse(data);
  } else {
    await characteristic.writeValue(data);
  }
}

function App() {
  // ----- BLE service references -----
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [hhiService, setHhiService] = useState<BluetoothRemoteGATTService | null>(
    null
  );

  // ----- UI states for config -----
  const [operatingMode, setOperatingMode] = useState<number>(0);
  const [stimAmplitude, setStimAmplitude] = useState<number>(10);
  const [stimFrequency, setStimFrequency] = useState<number>(20);
  const [stimPulseWidth, setStimPulseWidth] = useState<number>(200);
  const [stimNumPulses, setStimNumPulses] = useState<number>(5);
  const [emgThreshold, setEmgThreshold] = useState<number>(0);

  // ----- Battery, Wi-Fi, MQTT, etc. -----
  const [batteryLevel, setBatteryLevel] = useState<number>(0);
  const [wifiConnected, setWifiConnected] = useState<boolean>(false);
  const [mqttConnected, setMqttConnected] = useState<boolean>(false);
  const [wifiIP, setWifiIP] = useState<string>("");

  // Wi-Fi & MQTT
  const [wifiSSID, setWifiSSID] = useState<string>("");
  const [wifiPassword, setWifiPassword] = useState<string>("");
  const [mqttServerPort, setMqttServerPort] = useState<string>("");
  const [masterNameAddr, setMasterNameAddr] = useState<string>("");
  const [minionNameAddr, setMinionNameAddr] = useState<string>("");

  // ----- Snackbar for short-lived messages -----
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");

  const showMessage = (msg: string) => {
    setSnackbarMessage(msg);
    setSnackbarOpen(true);
    // Auto-close after ~1 second
    setTimeout(() => {
      setSnackbarOpen(false);
    }, 1000);
  };

  /**
   * Click handler to discover the BLE device, connect, and set up battery + HHI
   */
  const onConnectClick = async () => {
    try {
      // Request device with standard battery service + HHI service
      const bleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BATTERY_SERVICE_UUID, HHI_SERVICE_UUID],
      });
      setDevice(bleDevice);

      // Connect
      const gattServer = await bleDevice.gatt!.connect();

      // 1) Standard Battery
      try {
        const batService = await gattServer.getPrimaryService(BATTERY_SERVICE_UUID);
        const batChar = await batService.getCharacteristic(BATTERY_LEVEL_CHAR_UUID);

        // Read initial battery
        const initialBatt = await batChar.readValue();
        const initValue = fromDataView8(initialBatt);
        console.log("Initial battery:", initValue, "%");
        setBatteryLevel(initValue);

        // Start notifications
        await batChar.startNotifications();
        batChar.addEventListener("characteristicvaluechanged", (event) => {
          const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
          const newVal = fromDataView8(dv);
          console.log("Battery level changed notification:", newVal);
          setBatteryLevel(newVal);
        });
      } catch (err) {
        console.warn("Could not read from Battery Service:", err);
      }

      // 2) HHI Service (0xBB01)
      const service = await gattServer.getPrimaryService(HHI_SERVICE_UUID);
      setHhiService(service);

      // Read all relevant HHI characteristics
      await readInitialCharacteristics(service);

      // Start HHI notifications
      await startHhiNotifications(service);

      showMessage("Connected and ready!");
    } catch (err) {
      console.error("Connection error:", err);
      showMessage("Failed to connect. See console for details.");
    }
  };

  /**
   * Reads relevant characteristics from the HHI service
   */
  const readInitialCharacteristics = async (
    service: BluetoothRemoteGATTService
  ) => {
    try {
      // Operating Mode
      const modeChar = await service.getCharacteristic(UUIDs.operatingMode);
      const modeVal = await modeChar.readValue();
      const om = fromDataView8(modeVal);
      console.log("Read Operating Mode:", om);
      setOperatingMode(om);

      // Stim parameters
      const ampChar = await service.getCharacteristic(UUIDs.stimAmplitude);
      const ampVal = await ampChar.readValue();
      const ampNum = fromDataView8(ampVal);
      console.log("Read stimAmplitude:", ampNum);
      setStimAmplitude(ampNum);

      const freqChar = await service.getCharacteristic(UUIDs.stimFrequency);
      const freqVal = await freqChar.readValue();
      const freqNum = fromDataView8(freqVal);
      console.log("Read stimFrequency:", freqNum);
      setStimFrequency(freqNum);

      const pwChar = await service.getCharacteristic(UUIDs.stimPulseWidth);
      const pwVal = await pwChar.readValue();
      const pulseWidth = pwVal.getUint16(0, true);
      console.log("Read stimPulseWidth:", pulseWidth);
      setStimPulseWidth(pulseWidth);

      const numChar = await service.getCharacteristic(UUIDs.stimNumPulses);
      const numVal = await numChar.readValue();
      const numPulses = fromDataView8(numVal);
      console.log("Read stimNumPulses:", numPulses);
      setStimNumPulses(numPulses);

      // EMG Threshold
      try {
        const emgChar = await service.getCharacteristic(UUIDs.emgThreshold);
        const emgVal = await emgChar.readValue();
        const emgNum = fromDataView8(emgVal);
        console.log("Read EMG threshold:", emgNum);
        setEmgThreshold(emgNum);
      } catch (err) {
        console.warn("EMG threshold read not available:", err);
      }

      // Wi-Fi Status
      const wsChar = await service.getCharacteristic(UUIDs.wifiStatus);
      const wsVal = await wsChar.readValue();
      const wifiStat = fromDataView8(wsVal);
      console.log("Read Wi-Fi status byte:", wifiStat);
      setWifiConnected((wifiStat & 0x01) !== 0);
      setMqttConnected((wifiStat & 0x02) !== 0);

      // Wi-Fi IP
      const ipChar = await service.getCharacteristic(UUIDs.wifiIP);
      const ipVal = await ipChar.readValue();
      const ipStr = decodeString(ipVal);
      console.log("Read Wi-Fi IP:", ipStr);
      setWifiIP(ipStr);

      // Wi-Fi SSID
      try {
        const ssidChar = await service.getCharacteristic(UUIDs.wifiSSID);
        const ssidVal = await ssidChar.readValue();
        const ssidStr = decodeString(ssidVal);
        console.log("Read Wi-Fi SSID:", ssidStr);
        setWifiSSID(ssidStr);
      } catch (err) {
        console.warn("Wi-Fi SSID read not available:", err);
      }

      // Wi-Fi Password is write-only; skip reading

      // MQTT server/port
      try {
        const mqttChar = await service.getCharacteristic(UUIDs.mqttServerPort);
        const mqttVal = await mqttChar.readValue();
        const mqttStr = decodeString(mqttVal);
        console.log("Read MQTT server:", mqttStr);
        setMqttServerPort(mqttStr);
      } catch (err) {
        console.warn("MQTT server read not available:", err);
      }

      // Master name/address
      try {
        const masterChar = await service.getCharacteristic(UUIDs.masterNameAddr);
        const masterVal = await masterChar.readValue();
        const masterStr = decodeString(masterVal);
        console.log("Read Master Name:", masterStr);
        setMasterNameAddr(masterStr);
      } catch (err) {
        console.warn("Master name read not available:", err);
      }

      // Minion name/address
      try {
        const minionChar = await service.getCharacteristic(UUIDs.minionNameAddr);
        const minionVal = await minionChar.readValue();
        const minionStr = decodeString(minionVal);
        console.log("Read Minion Name:", minionStr);
        setMinionNameAddr(minionStr);
      } catch (err) {
        console.warn("Minion name read not available:", err);
      }
    } catch (err) {
      console.error("Error reading initial values:", err);
    }
  };

  /**
   * Start notifications for Wi-Fi status, IP, etc. from the HHI service
   */
  const startHhiNotifications = async (service: BluetoothRemoteGATTService) => {
    // Wi-Fi Status
    try {
      const wsChar = await service.getCharacteristic(UUIDs.wifiStatus);
      await wsChar.startNotifications();
      wsChar.addEventListener("characteristicvaluechanged", (event) => {
        const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        const wifiStat = fromDataView8(dv);
        console.log("Wi-Fi status changed (notification):", wifiStat);
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
        const ipStr = decodeString(dv);
        console.log("Wi-Fi IP changed (notification):", ipStr);
        setWifiIP(ipStr);
      });
    } catch (err) {
      console.warn("Wi-Fi IP notifications not available:", err);
    }
  };

  /**
   * Write only the operating mode (used for 0,1,2,3)
   */
  const onSaveOperatingMode = async () => {
    if (!hhiService) return;
    try {
      const modeChar = await hhiService.getCharacteristic(UUIDs.operatingMode);
      console.log("Writing operatingMode:", operatingMode);
      await modeChar.writeValue(toByteArray(operatingMode));
      showMessage(`Operating Mode updated to ${operatingMode}`);
    } catch (err) {
      console.error("Error writing operating mode:", err);
      showMessage("Failed to write operating mode.");
    }
  };

  /**
   * Write the stimulation-related characteristics (Mode 3)
   */
  const onSaveStimulationSettings = async () => {
    if (!hhiService) return;
    try {
      // Stimulation Amplitude
      const ampChar = await hhiService.getCharacteristic(UUIDs.stimAmplitude);
      console.log("Writing stimAmplitude:", stimAmplitude);
      await ampChar.writeValue(toByteArray(stimAmplitude));

      // Frequency
      const freqChar = await hhiService.getCharacteristic(UUIDs.stimFrequency);
      console.log("Writing stimFrequency:", stimFrequency);
      await freqChar.writeValue(toByteArray(stimFrequency));

      // Pulse Width (16-bit LE)
      const pwChar = await hhiService.getCharacteristic(UUIDs.stimPulseWidth);
      const pwData = new Uint8Array(2);
      new DataView(pwData.buffer).setUint16(0, stimPulseWidth, true);
      console.log("Writing stimPulseWidth:", stimPulseWidth);
      await pwChar.writeValue(pwData);

      // Number of pulses
      const numChar = await hhiService.getCharacteristic(UUIDs.stimNumPulses);
      console.log("Writing stimNumPulses:", stimNumPulses);
      await numChar.writeValue(toByteArray(stimNumPulses));

      // EMG Threshold
      try {
        const emgChar = await hhiService.getCharacteristic(UUIDs.emgThreshold);
        console.log("Writing emgThreshold:", emgThreshold);
        await emgChar.writeValue(toByteArray(emgThreshold));
      } catch (err) {
        console.warn("Unable to write EMG threshold:", err);
      }

      showMessage("Stimulation Settings updated successfully.");
    } catch (err) {
      console.error("Error writing stimulation settings:", err);
      showMessage("Failed to write stimulation settings.");
    }
  };

  /**
   * Write Wi-Fi, MQTT, Master, Minion
   */
  const onSaveWifiMqttSettings = async () => {
    if (!hhiService) return;
    try {
      // Wi-Fi SSID
      try {
        const ssidChar = await hhiService.getCharacteristic(UUIDs.wifiSSID);
        console.log("Writing Wi-Fi SSID:", wifiSSID);
        // If firmware uses Write With Response for SSID:
        await writeString(ssidChar, wifiSSID, false);
      } catch (err) {
        console.warn("Failed to write Wi-Fi SSID:", err);
      }

      // Wi-Fi Password (write-only)
      // If user typed something, let's send it. If your device always needs password, remove the 'if' check.
      if (wifiPassword.trim().length > 0) {
        try {
          const pwdChar = await hhiService.getCharacteristic(UUIDs.wifiPassword);
          console.log("Writing Wi-Fi Password (write-only): [REDACTED]");
          // If firmware uses Write Without Response for password:
          await writeString(pwdChar, wifiPassword, true);
        } catch (err) {
          console.warn("Failed to write Wi-Fi Password:", err);
        }
      }

      // MQTT server/port
      try {
        const mqttChar = await hhiService.getCharacteristic(UUIDs.mqttServerPort);
        console.log("Writing MQTT server:", mqttServerPort);
        await writeString(mqttChar, mqttServerPort);
      } catch (err) {
        console.warn("Failed to write MQTT server/port:", err);
      }

      // Master name
      try {
        const masterChar = await hhiService.getCharacteristic(UUIDs.masterNameAddr);
        console.log("Writing Master Name:", masterNameAddr);
        await writeString(masterChar, masterNameAddr);
      } catch (err) {
        console.warn("Failed to write Master name:", err);
      }

      // Minion name
      try {
        const minionChar = await hhiService.getCharacteristic(UUIDs.minionNameAddr);
        console.log("Writing Minion Name:", minionNameAddr);
        await writeString(minionChar, minionNameAddr);
      } catch (err) {
        console.warn("Failed to write Minion name:", err);
      }

      showMessage("Wi-Fi/MQTT settings updated successfully.");
    } catch (err) {
      console.error("Error writing Wi-Fi/MQTT settings:", err);
      showMessage("Failed to write Wi-Fi/MQTT settings.");
    }
  };

  /**
   * Trigger stimulation (write 1 to 0xBB12)
   */
  const onTriggerStimulation = async () => {
    if (!hhiService) return;
    try {
      const triggerChar = await hhiService.getCharacteristic(
        UUIDs.triggerStimulation
      );
      console.log("Triggering Stimulation: 1");
      await triggerChar.writeValue(toByteArray(1));
      showMessage("Stimulation triggered!");
    } catch (err) {
      console.error("Error triggering stimulation:", err);
      showMessage("Failed to trigger stimulation.");
    }
  };

  /**
   * Stop stimulation manually (write 0 to 0xBB12).
   * Useful when stimNumPulses=0 (infinite) or user wants to abort.
   */
  const onStopStimulation = async () => {
    if (!hhiService) return;
    try {
      const triggerChar = await hhiService.getCharacteristic(
        UUIDs.triggerStimulation
      );
      console.log("Stopping Stimulation: 0");
      await triggerChar.writeValue(toByteArray(0));
      showMessage("Stimulation stopped.");
    } catch (err) {
      console.error("Error stopping stimulation:", err);
      showMessage("Failed to stop stimulation.");
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
                Wi-Fi: {wifiConnected ? "Connected" : "Disconnected"},{" "}
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
                    <MenuItem value={0}>Mode 0 - Traditional HHI</MenuItem>
                    <MenuItem value={1}>Mode 1 - Master/Controller</MenuItem>
                    <MenuItem value={2}>Mode 2 - Minion/Remote</MenuItem>
                    <MenuItem value={3}>Mode 3 - Custom</MenuItem>
                  </Select>
                </FormControl>
                <Button variant="contained" onClick={onSaveOperatingMode}>
                  Save Operating Mode
                </Button>

                {/* If mode=3, show custom stimulation UI */}
                {operatingMode === 3 && (
                  <Box mt={4}>
                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="Stimulation Amplitude (0-50, 255=pot?)"
                      value={stimAmplitude}
                      onChange={(e) => setStimAmplitude(Number(e.target.value))}
                    />

                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="Stimulation Frequency (1-100 Hz)"
                      value={stimFrequency}
                      onChange={(e) => setStimFrequency(Number(e.target.value))}
                    />

                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="Stimulation Pulse Width (50-1000 µs)"
                      value={stimPulseWidth}
                      onChange={(e) => setStimPulseWidth(Number(e.target.value))}
                    />

                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="Number of Pulses (0=∞ until stopped)"
                      value={stimNumPulses}
                      onChange={(e) => setStimNumPulses(Number(e.target.value))}
                    />

                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="EMG Threshold (0-5, 255=button?)"
                      value={emgThreshold}
                      onChange={(e) => setEmgThreshold(Number(e.target.value))}
                    />

                    <Button
                      variant="contained"
                      sx={{ mt: 2, mr: 2 }}
                      onClick={onSaveStimulationSettings}
                    >
                      Save Stimulation Settings
                    </Button>

                    <Box mt={4}>
                      <Typography variant="h6">Manual Trigger</Typography>
                      <Button
                        variant="contained"
                        color="secondary"
                        sx={{ mt: 2, mr: 2 }}
                        onClick={onTriggerStimulation}
                      >
                        Start Stimulation
                      </Button>
                      <Button
                        variant="contained"
                        color="warning"
                        sx={{ mt: 2 }}
                        onClick={onStopStimulation}
                      >
                        Stop Stimulation
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>

              {/* If in mode 1 or 2, show Wi-Fi / MQTT config */}
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
                    sx={{ mt: 2 }}
                    onClick={onSaveWifiMqttSettings}
                  >
                    Save Wi-Fi / MQTT / Master/Minion
                  </Button>
                </Box>
              )}
            </>
          ) : (
            // Not connected => show a connect button
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

      {/* Snackbar for short-lived messages */}
      <Snackbar
        open={snackbarOpen}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" sx={{ width: "100%" }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </>
  );
}

export default App;
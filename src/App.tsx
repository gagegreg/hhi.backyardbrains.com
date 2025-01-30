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

// ----- BLE Service/Characteristic UUIDs ----- //
const HHI_SERVICE_UUID = 0xBB01;

// If your device truly uses a custom battery characteristic at 0xBB08:
const CUSTOM_BATTERY_CHAR_UUID = 0xBB08;

// If your device implements standard Battery Service (0x180F) → Battery Level (0x2A19):
const BATTERY_SERVICE_UUID = 0x180F;
const BATTERY_LEVEL_CHAR_UUID = 0x2A19;

const UUIDs = {
  operatingMode: 0xBB02,
  stimAmplitude: 0xBB03,
  stimFrequency: 0xBB04,
  stimPulseWidth: 0xBB05,
  // 0xBB06 is reserved (or a 16-bit amplitude?), check your doc/firmware
  emgThreshold: 0xBB07,
  batteryLevel: 0xBB08, // R/Notify in the original code (but your doc says "Reserved"?)
  mqttServerPort: 0xBB09,
  masterNameAddr: 0xBB0A,
  minionNameAddr: 0xBB0B,
  wifiSSID: 0xBB0C,
  wifiPassword: 0xBB0D,
  wifiStatus: 0xBB0E,
  wifiIP: 0xBB0F,
  currentStimAmplitude: 0xBB10,
  currentEmgThreshold: 0xBB11,
  triggerStimulation: 0xBB12,
  stimNumPulses: 0xBB13,
};

function toByteArray(num: number) {
  return new Uint8Array([num & 0xff]);
}
function fromDataView8(dataView: DataView): number {
  return dataView.getUint8(0);
}
function decodeString(value: DataView) {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(value.buffer);
}
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
  const [hhiService, setHhiService] = useState<BluetoothRemoteGATTService | null>(
    null
  );

  // -- Possibly store the standard battery characteristic separately
  const [batteryChar, setBatteryChar] =
    useState<BluetoothRemoteGATTCharacteristic | null>(null);

  // -- Some example UI states
  const [operatingMode, setOperatingMode] = useState<number>(0);
  const [stimAmplitude, setStimAmplitude] = useState<number>(10);
  const [stimFrequency, setStimFrequency] = useState<number>(20);
  const [stimPulseWidth, setStimPulseWidth] = useState<number>(200);
  const [stimNumPulses, setStimNumPulses] = useState<number>(5);
  const [emgThreshold, setEmgThreshold] = useState<number>(0);

  // Status
  const [batteryLevel, setBatteryLevel] = useState<number>(0);
  const [wifiConnected, setWifiConnected] = useState<boolean>(false);
  const [mqttConnected, setMqttConnected] = useState<boolean>(false);
  const [wifiIP, setWifiIP] = useState<string>("");

  // Wi-Fi/MQTT
  const [wifiSSID, setWifiSSID] = useState<string>("");
  const [wifiPassword, setWifiPassword] = useState<string>("");
  const [mqttServerPort, setMqttServerPort] = useState<string>("");
  const [masterNameAddr, setMasterNameAddr] = useState<string>("");
  const [minionNameAddr, setMinionNameAddr] = useState<string>("");

  // -- Snackbar states for transient messages
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
   * Click handler to discover the BLE device and connect.
   */
  const onConnectClick = async () => {
    try {
      // Request a device with the HHI Service, and optionally battery service if your firmware uses standard 0x180F:
      const bleDevice = await navigator.bluetooth.requestDevice({
        // filters: [{ services: [HHI_SERVICE_UUID] }], 
        // If you trust your device will have the same name, you can do filters:
        acceptAllDevices: true,
        optionalServices: [HHI_SERVICE_UUID, BATTERY_SERVICE_UUID],
      });
      setDevice(bleDevice);

      // Connect to GATT Server
      const gattServer = await bleDevice.gatt!.connect();

      // Get HHI Service (0xBB01)
      const service = await gattServer.getPrimaryService(HHI_SERVICE_UUID);
      setHhiService(service);

      // Also attempt to get standard Battery Service (0x180F)
      try {
        const batService = await gattServer.getPrimaryService(BATTERY_SERVICE_UUID);
        const batChar = await batService.getCharacteristic(BATTERY_LEVEL_CHAR_UUID);
        setBatteryChar(batChar);

        // Read initial battery from standard service
        const initialBatt = await batChar.readValue();
        setBatteryLevel(fromDataView8(initialBatt));
        // Start notifications
        await batChar.startNotifications();
        batChar.addEventListener("characteristicvaluechanged", (event) => {
          const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
          setBatteryLevel(fromDataView8(dv));
        });
      } catch (err) {
        console.warn("Standard battery service not found or no notify support:", err);
      }

      // Read initial characteristics from the custom HHI service
      await readInitialCharacteristics(service);

      // Start HHI notifications (battery, wifi status, wifi IP, etc.)
      await startHhiNotifications(service);

      showMessage("Connected and ready!");
    } catch (err) {
      console.error("Connection error:", err);
      showMessage("Failed to connect. See console for details.");
    }
  };

  /**
   * Read initial values from relevant characteristics in the HHI service
   */
  const readInitialCharacteristics = async (
    service: BluetoothRemoteGATTService
  ) => {
    try {
      // Operating Mode
      const modeChar = await service.getCharacteristic(UUIDs.operatingMode);
      const modeVal = await modeChar.readValue();
      setOperatingMode(fromDataView8(modeVal));

      // Stim params, only relevant if in mode 3, but let's read them anyway
      const ampChar = await service.getCharacteristic(UUIDs.stimAmplitude);
      const ampVal = await ampChar.readValue();
      setStimAmplitude(fromDataView8(ampVal));

      const freqChar = await service.getCharacteristic(UUIDs.stimFrequency);
      const freqVal = await freqChar.readValue();
      setStimFrequency(fromDataView8(freqVal));

      const pwChar = await service.getCharacteristic(UUIDs.stimPulseWidth);
      const pwVal = await pwChar.readValue();
      const pulseWidth = pwVal.getUint16(0, true);
      setStimPulseWidth(pulseWidth);

      const numChar = await service.getCharacteristic(UUIDs.stimNumPulses);
      const numVal = await numChar.readValue();
      setStimNumPulses(fromDataView8(numVal));

      // Battery from custom 0xBB08 (only if your firmware uses it):
      try {
        const battChar = await service.getCharacteristic(UUIDs.batteryLevel);
        const battVal = await battChar.readValue();
        setBatteryLevel(fromDataView8(battVal));
      } catch (err) {
        console.warn("Custom battery characteristic 0xBB08 not found:", err);
      }

      // Wi-Fi Status
      const wsChar = await service.getCharacteristic(UUIDs.wifiStatus);
      const wsVal = await wsChar.readValue();
      const wifiStat = fromDataView8(wsVal);
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

      // Wi-Fi Password is write-only, skip reading

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
   * Start notifications for custom battery (if present), Wi-Fi Status, Wi-Fi IP, etc. 
   * (This is only for the 0xBB01 HHI service. The standard battery is handled separately above.)
   */
  const startHhiNotifications = async (service: BluetoothRemoteGATTService) => {
    // Start custom battery notifications if your device uses 0xBB08 that way
    try {
      const battChar = await service.getCharacteristic(UUIDs.batteryLevel);
      await battChar.startNotifications();
      battChar.addEventListener("characteristicvaluechanged", (event) => {
        const dv = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        setBatteryLevel(fromDataView8(dv));
      });
    } catch (err) {
      console.warn("Custom battery notifications not available:", err);
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
   * Save ONLY the operating mode (used in all modes).
   * This addresses the complaint that mode 0,1,2 were never sent to the device.
   */
  const onSaveOperatingMode = async () => {
    if (!hhiService) return;
    try {
      const modeChar = await hhiService.getCharacteristic(UUIDs.operatingMode);
      await modeChar.writeValue(toByteArray(operatingMode));
      showMessage(`Operating Mode updated to ${operatingMode}`);
    } catch (err) {
      console.error("Error writing operating mode:", err);
      showMessage("Failed to write operating mode.");
    }
  };

  /**
   * Write the current UI settings to the device's stimulation-related characteristics
   * (Only relevant for Mode 3 in your design.)
   */
  const onSaveStimulationSettings = async () => {
    if (!hhiService) return;
    try {
      // We can assume the device is in mode 3, but if not, it's okay to still attempt.
      const ampChar = await hhiService.getCharacteristic(UUIDs.stimAmplitude);
      await ampChar.writeValue(toByteArray(stimAmplitude));

      const freqChar = await hhiService.getCharacteristic(UUIDs.stimFrequency);
      await freqChar.writeValue(toByteArray(stimFrequency));

      // Pulse Width (16-bit)
      const pwChar = await hhiService.getCharacteristic(UUIDs.stimPulseWidth);
      const pwData = new Uint8Array(2);
      new DataView(pwData.buffer).setUint16(0, stimPulseWidth, true);
      await pwChar.writeValue(pwData);

      // Number of pulses
      const numChar = await hhiService.getCharacteristic(UUIDs.stimNumPulses);
      await numChar.writeValue(toByteArray(stimNumPulses));

      // EMG Threshold
      try {
        const emgChar = await hhiService.getCharacteristic(UUIDs.emgThreshold);
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

      showMessage("Wi-Fi/MQTT settings updated successfully.");
    } catch (err) {
      console.error("Error writing Wi-Fi/MQTT settings:", err);
      showMessage("Failed to write Wi-Fi/MQTT settings.");
    }
  };

  /**
   * Trigger a single stimulation train in Mode 3
   */
  const onTriggerStimulation = async () => {
    if (!hhiService) return;
    try {
      const triggerChar = await hhiService.getCharacteristic(
        UUIDs.triggerStimulation
      );
      // Write "1" to start stimulation
      await triggerChar.writeValue(toByteArray(1));
      showMessage("Stimulation triggered!");
    } catch (err) {
      console.error("Error triggering stimulation:", err);
      showMessage("Failed to trigger stimulation.");
    }
  };

  /**
   * Stop stimulation manually (write "0" to the same trigger characteristic).
   * The device should interpret that as "abort/stop now."
   */
  const onStopStimulation = async () => {
    if (!hhiService) return;
    try {
      const triggerChar = await hhiService.getCharacteristic(
        UUIDs.triggerStimulation
      );
      // Write "0" to stop stimulation
      await triggerChar.writeValue(toByteArray(0));
      showMessage("Stimulation stopped (manual).");
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
                    <MenuItem value={1}>Mode 1 - Master/Remote Controller</MenuItem>
                    <MenuItem value={2}>Mode 2 - Minion/Remote End</MenuItem>
                    <MenuItem value={3}>Mode 3 - Custom</MenuItem>
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={onSaveOperatingMode}
                >
                  Save Operating Mode
                </Button>

                {/* Show these stimulation settings only if in Mode 3 */}
                {operatingMode === 3 && (
                  <Box mt={4}>
                    <TextField
                      fullWidth
                      margin="normal"
                      type="number"
                      label="Stimulation Amplitude (0-50 mA, 255=pot?)"
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
                      label="Number of Pulses (Mode 3)"
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
                      color="primary"
                      onClick={onSaveStimulationSettings}
                      sx={{ mt: 2 }}
                    >
                      Save Stimulation Settings
                    </Button>

                    <Box mt={4}>
                      <Typography variant="h6">Trigger Custom Stimulation</Typography>
                      <Button
                        variant="contained"
                        color="secondary"
                        onClick={onTriggerStimulation}
                        sx={{ mt: 2, mr: 2 }}
                      >
                        Start Stimulation
                      </Button>
                      <Button
                        variant="contained"
                        color="warning"
                        onClick={onStopStimulation}
                        sx={{ mt: 2 }}
                      >
                        Stop Stimulation
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>

              {/* If in Mode 1 or 2, show Wi-Fi / MQTT config */}
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

      {/* Snackbar for transient messages */}
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
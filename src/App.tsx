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
import BluetoothSearchingIcon from '@mui/icons-material/BluetoothSearching';

// ----- BLE Service/Characteristic UUIDs ----- //
const HHI_SERVICE_UUID = 0xBB01;
const UUIDs = {
  operatingMode: 0xBB02,
  stimAmplitude: 0xBB03,
  stimFrequency: 0xBB04,
  stimPulseWidth: 0xBB05,
  emgThreshold: 0xBB07,
  batteryLevel: 0xBB08,     // R/Notify
  wifiStatus: 0xBB0E,       // R/Notify
  wifiIP: 0xBB0F,           // R/Notify
  triggerStimulation: 0xBB12,
  stimNumPulses: 0xBB13,
};

function toByteArray(num: number) {
  return new Uint8Array([num & 0xff]);
}
function fromDataView8(dataView: DataView): number {
  return dataView.getUint8(0);
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
  const [wifiConnected, setWifiConnected] = useState<boolean>(false);
  const [wifiIP, setWifiIP] = useState<string>("");

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
      setWifiConnected(fromDataView8(wsVal) === 1);

      // Wi-Fi IP
      const ipChar = await service.getCharacteristic(UUIDs.wifiIP);
      const ipVal = await ipChar.readValue();
      const decoder = new TextDecoder("utf-8");
      setWifiIP(decoder.decode(ipVal.buffer));
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
        setWifiConnected(fromDataView8(dv) === 1);
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
        const decoder = new TextDecoder("utf-8");
        setWifiIP(decoder.decode(dv.buffer));
      });
    } catch (err) {
      console.warn("Wi-Fi IP notifications not available:", err);
    }
  };

  /**
   * Write the current UI settings to the device's characteristics
   */
  const onSaveSettings = async () => {
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

      alert("Settings updated successfully.");
    } catch (err) {
      console.error("Error writing settings:", err);
      alert("Failed to write settings.");
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
              <Typography>Wi-Fi: {wifiConnected ? "Connected" : "Disconnected"}</Typography>
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

                <Button
                  variant="contained"
                  color="primary"
                  onClick={onSaveSettings}
                  sx={{ mt: 2 }}
                >
                  Save Settings
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
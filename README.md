# Human Human Interface (HHI) Testing App

## Overview

The Human Human Interface (HHI) Testing App is designed to evaluate and interact with the Backyard Brains HHI devices. While the current HHI serves as a suitable demonstration device, it lacks the depth required for extensive research. The upcoming HHIv3 aims to bridge this gap by introducing two new features:

1. **Remote Control**
2. **Lab Stimulation**

By default, the device operates as HHIv2. When connected via the app over Bluetooth Low Energy (BLE), users can configure and control the device, enabling:

- Customization of stimulation and recording settings.
- Connection to remote HHI devices.
- Configuration to connect to a dedicated Wi-Fi network for remote stimulation without the need for a connected device.

The stimulation settings support protocols similar to SpikeStation, catering to neuroscience, invertebrate, and human physiology laboratories. This enhancement enables a variety of new experiments, including clinical-like applications.

## Hardware

The HHI hardware may undergo the following modifications to improve functionality and durability:

- **Form Factor Adjustments:**
  - **Knob:** The current top knob is prone to detachment. A consultation with Alex is planned to address this. The first prototype will be housed in an HHI enclosure.
  
- **Components:**
  - **Buttons:**
    - *Current Button:* Tends to get stuck in the button hole due to collision with the battery. Replacement with Surface-Mount Technology (SMT) is necessary. The risk of it popping off is mitigated by the support of the case.
  - **Controls & Indicators:**
    - 1 On/Off Amplitude Knob
    - 1 Stimulation LED (RGB)
    - 1 Power LED (RGB)
  - **Ports:**
    - 1 USB-C Port
    - Legacy Port: Dropped due to compatibility issues with MFi and USB-C standards.

## BLE Control Service

This application tests the BLE protocol through the Backyard Brains HHI Control Service (BB01). Below is an overview of the BLE GATT profile, detailing all characteristics required for device configuration, status monitoring, and Wi-Fi credential setup for remote operations.

### Backyard Brains HHI Control Service (BB01)

#### 1. Service Overview

- **Service Name:** Backyard Brains HHI Control Service
- **Service UUID:** `0xBB01`

**Core Functionalities:**

- **HHI Configuration:** Manage operating modes, stimulation parameters, EMG thresholds, etc.
- **Device Status:** Monitor battery levels and diagnose errors.
- **Wi-Fi Settings:** Configure SSID, password, IP address, and connection status to enable network connectivity and internet communication.

#### 2. Characteristics Table

The following table outlines the GATT characteristics within the BB01 service. Each characteristic is identified by a unique 16-bit UUID. Ensure that the value formats and ranges align with your firmware and hardware specifications.

| **Characteristic**               | **UUID** | **Properties** | **Data Format**         | **Value Range / Units**                                                      | **Description**                                                                                                                                                                                                                                                                                                                     |
|----------------------------------|----------|-----------------|-------------------------|------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Operating Mode**               | `0xBB02` | R/W             | 8-bit integer           | 0–3                                                                          | Selects the device’s operating mode:<br>0 = Mode 0 (Traditional HHI)<br>1 = Mode 1 (Remote Controller)<br>2 = Mode 2 (Remote Minion)<br>3 = Mode 3 (Custom).                                                                                                                                                                       |
| **Stimulation Amplitude**        | `0xBB03` | R/W             | 8-bit integer (scaled)  | 0–30 mA or 255 (special value)                                              | Sets the stimulation current.<br>Each integer represents 1 mA.<br>Example:<br>0 = 0 mA (off)<br>30 = 30 mA (max)<br>Special Value: 255 = Use POT value.                                                                                                                                                                            |
| **Stimulation Frequency**        | `0xBB04` | R/W             | 8-bit integer           | 1–100 Hz                                                                     | Defines the stimulation pulse frequency in custom/remote modes.                                                                                                                                                                                                                                                                     |
| **Stimulation Pulse Width**      | `0xBB05` | R/W             | 16-bit integer (µs)     | 50–1000 µs                                                                    | Duration of each stimulation pulse in microseconds. Default might be 250 µs.                                                                                                                                                                                                                                                        |
| **RESERVED**                     | `0xBB06` |                 |                         |                                                                              |                                                                                                                                                                                                                                                                                                                                     |
| **EMG Threshold**                | `0xBB07` | R/W             | 8-bit integer           | Threshold Value (0-5) or 0xFF (special value)                              | Normalized EMG amplitude required to trigger stimulation.<br>Special Value: 0xFF = Use hardware button to control threshold cycling.                                                                                                                                                                                                       |
| **Battery Level**                | `0xBB08` | R/Notify         | 8-bit integer           | 0–100%                                                                       | Reports current battery level. The device can send notifications when the battery changes (e.g., drops by 5%).                                                                                                                                                                                                                         |
| **Set MQTT Server and Port**     | `0xBB09` | R/W             | UTF-8 string            | Up to 64 characters                                                          | Configure the address and port of the MQTT server for communication between master/minion devices.<br>**Example:**<br>`mqtt://8.tcp.eu.ngrok.io:22636`                                                                                                                                                                              |
| **Set Master Name/Address**      | `0xBB0A` | R/W             | UTF-8 string            | Up to 32 characters                                                          | Configure the Master name/address for pairing master/minion HHI devices.                                                                                                                                                                                                                                                             |
| **Set Minion Name/Address**      | `0xBB0B` | R/W             | UTF-8 string            | Up to 32 characters                                                          | Configure the Minion name/address for pairing master/minion HHI devices.                                                                                                                                                                                                                                                             |
| **Wi-Fi SSID**                   | `0xBB0C` | R/W             | UTF-8 string            | Up to 32 characters                                                          | The network SSID. Users enter their Wi-Fi network name here. The device can optionally allow reading this back (R) so users can confirm the currently stored SSID.                                                                                                                                                                       |
| **Wi-Fi Password**               | `0xBB0D` | Write Only      | UTF-8 string            | Up to 64 characters                                                          | The Wi-Fi passphrase. Storing or reading the password in plain text poses security risks.<br>**Recommendation:**<br>Use “Write Only” (no read permission) to prevent the device from transmitting the password back, enhancing security.                                                                                          |
| **Wi-Fi Connection Status**      | `0xBB0E` | R/Notify         | 8-bit integer           | 0 = Disconnected<br>1 = Connected                                           | Indicates the Wi-Fi connection state:<br>0 = Not connected<br>1 = Connected<br>Other codes may represent “error,” “connecting,” etc.<br>The device can notify the app when the status changes (e.g., after applying new SSID/password).<br>**Bit Definitions:**<br>Bit 0 - WiFi connection status<br>Bit 1 - MQTT server connection status |
| **Wi-Fi IP Address**             | `0xBB0F` | R/Notify         | UTF-8 string            | IPv4/IPv6                                                                    | The local IP address acquired after connecting to Wi-Fi.<br>Typically an ASCII string for readability.<br>**Examples:**<br>- IPv4: `192.168.1.10`<br>- IPv6: `2001:db8::1`<br>The device can notify the app whenever it successfully obtains or loses an IP address.                                                              |
| **Current Stimulation Amplitude**| `0xBB10` | Read/Notify      | 8-bit integer (scaled)  | 0–30 mA                                                                      | Reports the current stimulation amplitude, either set by the app or dynamically determined by the POT in manual mode (0xFF).                                                                                                                                                                                                         |
| **Current EMG Threshold**        | `0xBB11` | Read/Notify      | 8-bit integer           | Values: 0-5                                                                  | Reports the current EMG threshold (0-5), either set by the app or dynamically determined by the button in manual mode (0xFF).                                                                                                                                                                                                     |
| **Trigger Stimulation**          | `0xBB12` | Write Only      | 8-bit integer           | Value: 1                                                                     | During Mode 3, used to send a stimulation command to HHI.                                                                                                                                                                                                                                                                          |
| **Stimulation Number of Pulses** | `0xBB13` | Read/Write       | 8-bit integer           |                                                                              | During Mode 3, controls the number of pulses used in stimulation. Along with pulse width and pulse frequency, a specific pulse train is designed and sent.                                                                                                                                                                         |

## Getting Started

### Prerequisites

- **Node.js**: Ensure you have Node.js installed on your machine. You can download it from [here](https://nodejs.org/).
- **Bluetooth-Enabled Device**: A device with BLE capabilities to connect with the HHI.

### Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-repo/hhi-testing-app.git
   cd hhi-testing-app
   ```

2. **Install Dependencies:**

   ```bash
   npm install
   ```

3. **Run the Application:**

   ```bash
   npm start
   ```

   The app should now be running on `http://localhost:3000`.

## Usage

1. **Connecting to HHI:**
   - Open the app and navigate to the "Connect" section.
   - Click on the "Connect" button to discover and pair with your HHI device.

2. **Configuring HHI:**
   - Once connected, navigate to the "Configuration" tab.
   - Adjust operating modes, stimulation parameters, EMG thresholds, and Wi-Fi settings as needed.

3. **Monitoring Status:**
   - The "Status" section provides real-time updates on battery levels, Wi-Fi connection status, and more.

4. **Remote Operations:**
   - Utilize the remote control features to manage multiple HHI devices and perform remote stimulations.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the [MIT License](LICENSE).

## Contact

For any inquiries or support, please contact [your.email@example.com](mailto:your.email@example.com).

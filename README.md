# Open WebUI App

![image](https://github.com/user-attachments/assets/89f3a08d-26a2-424e-93e4-e619c1f0321e)

**Open WebUI App** is a desktop application built using Electron that provides an intuitive interface to interact with Open WebUI services. It supports both local and remote connections, offers customizable global hotkeys, and features a companion window for quick access.

---

## 🚀 Features

- **Platform**: Works on Windows. TODO: macOS, and Linux.
- **Local & Remote Access**: Connect to a local Open WebUI instance or a remote server.
- **Customizable Hotkeys**: Configure global hotkey for quick actions.
- **Companion Window**: Lightweight companion window for quick tasks.
- **Installer Wizard**: Simple installation and configuration process.
- **System Tray Integration**: Quick access from the system tray.
- **Auto-Launch**: Option to launch the app automatically at system startup.

---

## 📦 Installation

### Prerequisites
- [Node.js](https://nodejs.org) (LTS version recommended)
- [Electron](https://www.electronjs.org/)

### Clone the Repository
```bash
git clone https://github.com/emzaedu/Open-WebUI-App.git
cd Open-WebUI-App
```

### Install Dependencies
```bash
npm install
```

### Run the Application
```bash
npm start
```

---

## 🏗️ Build for Production

To create a distributable package:
```bash
npm run dist
```
The output will be available in the `dist` directory.

---

## ⚙️ Configuration

The application uses a default URL of `http://127.0.0.1:19999` for local instances. You can modify this in the settings window at first run or by editing `config.js`.

**Default Configurations:**
- `defaultUrl`: Local service URL
- `defaultUserAgent`: Custom user agent string

---

## 🗝️ Hotkeys

Global hotkeys can be configured in the app. Default shortcuts include:
- `Ctrl+Space`: Toggle the companion window
- `Ctrl+N`: Start a new chat
- `Ctrl+W`: Close the current window
- `Ctrl+Q`: Quit the application

---

## 🌐 Remote Access

To connect to a remote Open WebUI server:
1. At firts run use installer wizard (`installer.html`).
2. Select **Remote** option and enter the server URL.
3. Click **Confirm** to save settings.

---

## 🔧 Local Installation
1. At firts run use installer wizard (`installer.html`).
2. Select **Local** option and configure the host, port, and options.
3. Click **Install and Configure** to start the service locally.

---

## 🧩 Companion Window

The companion window provides quick access to Open WebUI. It can be toggled using the configured global hotkey.

---

## 🖥️ System Tray

The app runs in the system tray when minimized. Right-click the tray icon to access options such as:
- Toggle main window
- Reload application
- Open hotkey configuration
- Enable/disable auto-launch
- Quit application

---

## 🛠️ Development

### Folder Structure
- `main.js`: Main Electron process
- `preload.js`: Secure communication bridge
- `index.html`: Loading screen UI
- `hotkey.html`: Hotkey configuration UI
- `installer.html`: Installation wizard
- `config.js`: Default configurations

---

## 🗃️ Dependencies

- Electron
- tree-kill
- winreg

---

## 📝 License

This project is licensed under the **Do whatever you want with this.**.

---

## 🤝 Contributing

Contributions are welcome! Feel free to fork the repository, submit issues, or create pull requests.

---

## 📧 Contact

For support or questions, please open an issue on [GitHub](https://github.com/emzaedu/Open-WebUI-App/issues).

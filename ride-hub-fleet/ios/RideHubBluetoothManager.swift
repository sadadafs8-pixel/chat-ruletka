import Foundation
import CoreBluetooth
import CryptoKit

struct NearbyFleetScooter: Identifiable, Equatable {
    let id: UUID
    let peripheral: CBPeripheral
    var name: String
    var deviceId: String?
    var rssi: Int
    var state: String
}

@MainActor
final class RideHubBluetoothManager: NSObject, ObservableObject {
    static let serviceUUID = CBUUID(string: "8F2A0001-9C5B-4A6E-9D51-22C3DBE00001")
    static let deviceUUID = CBUUID(string: "8F2A0002-9C5B-4A6E-9D51-22C3DBE00001")
    static let challengeUUID = CBUUID(string: "8F2A0003-9C5B-4A6E-9D51-22C3DBE00001")
    static let commandUUID = CBUUID(string: "8F2A0004-9C5B-4A6E-9D51-22C3DBE00001")
    static let stateUUID = CBUUID(string: "8F2A0005-9C5B-4A6E-9D51-22C3DBE00001")

    @Published var nearby: [NearbyFleetScooter] = []
    @Published var bluetoothReady = false
    @Published var statusText = "Bluetooth запускается…"
    @Published var connectedDeviceId: String?

    private var central: CBCentralManager!
    private let keyStore: FleetKeyStore
    private var selectedPeripheral: CBPeripheral?
    private var deviceCharacteristic: CBCharacteristic?
    private var challengeCharacteristic: CBCharacteristic?
    private var commandCharacteristic: CBCharacteristic?
    private var stateCharacteristic: CBCharacteristic?
    private var currentChallenge: String?

    init(keyStore: FleetKeyStore) {
        self.keyStore = keyStore
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func startScan() {
        guard central.state == .poweredOn else {
            statusText = "Включи Bluetooth"
            return
        }
        nearby.removeAll()
        central.scanForPeripherals(withServices: [Self.serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        statusText = "Ищу самокаты Ride Hub рядом…"
    }

    func stopScan() {
        central.stopScan()
    }

    func connect(_ item: NearbyFleetScooter) {
        stopScan()
        selectedPeripheral = item.peripheral
        item.peripheral.delegate = self
        statusText = "Подключаюсь к \(item.name)…"
        central.connect(item.peripheral, options: nil)
    }

    func disconnect() {
        if let p = selectedPeripheral { central.cancelPeripheralConnection(p) }
    }

    func unlock() {
        guard let peripheral = selectedPeripheral,
              peripheral.state == .connected,
              let commandCharacteristic,
              let deviceId = connectedDeviceId,
              let challenge = currentChallenge,
              let key = keyStore.key(for: deviceId),
              let secret = Data(hex: key.secretHex) else {
            statusText = "Нет ключа для этого самоката"
            return
        }

        let ts = Int(Date().timeIntervalSince1970)
        let payload = "UNLOCK|\(deviceId)|\(challenge)|\(ts)"
        let symmetricKey = SymmetricKey(data: secret)
        let mac = HMAC<SHA256>.authenticationCode(for: Data(payload.utf8), using: symmetricKey)
        let signature = Data(mac).hexString
        let packet = "\(payload)|\(signature)"

        guard let data = packet.data(using: .utf8) else { return }
        let type: CBCharacteristicWriteType = commandCharacteristic.properties.contains(.write) ? .withResponse : .withoutResponse
        peripheral.writeValue(data, for: commandCharacteristic, type: type)
        statusText = "Команда отправлена…"
    }

    func connectNearestAuthorized() {
        let authorized = nearby.filter { item in
            guard let id = item.deviceId else { return false }
            return keyStore.key(for: id) != nil
        }
        guard let nearest = authorized.max(by: { $0.rssi < $1.rssi }) else {
            statusText = "Авторизованный самокат рядом не найден"
            return
        }
        connect(nearest)
    }

    private func updateNearby(peripheral: CBPeripheral, rssi: Int, deviceId: String? = nil, state: String? = nil) {
        if let i = nearby.firstIndex(where: { $0.id == peripheral.identifier }) {
            nearby[i].rssi = rssi
            if let deviceId { nearby[i].deviceId = deviceId }
            if let state { nearby[i].state = state }
        } else {
            nearby.append(NearbyFleetScooter(
                id: peripheral.identifier,
                peripheral: peripheral,
                name: peripheral.name ?? "Ride Hub Scooter",
                deviceId: deviceId,
                rssi: rssi,
                state: state ?? "Рядом"
            ))
        }
        nearby.sort { $0.rssi > $1.rssi }
    }
}

extension RideHubBluetoothManager: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Task { @MainActor in
            bluetoothReady = central.state == .poweredOn
            statusText = bluetoothReady ? "Bluetooth готов" : "Bluetooth недоступен"
            if bluetoothReady { startScan() }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        Task { @MainActor in
            updateNearby(peripheral: peripheral, rssi: RSSI.intValue)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            statusText = "Подключено. Проверяю ID…"
            peripheral.discoverServices([Self.serviceUUID])
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in statusText = "Не удалось подключиться: \(error?.localizedDescription ?? "ошибка")" }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            connectedDeviceId = nil
            currentChallenge = nil
            deviceCharacteristic = nil
            challengeCharacteristic = nil
            commandCharacteristic = nil
            stateCharacteristic = nil
            selectedPeripheral = nil
            statusText = "Отключено"
            startScan()
        }
    }
}

extension RideHubBluetoothManager: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let services = peripheral.services else { return }
        for service in services where service.uuid == Self.serviceUUID {
            peripheral.discoverCharacteristics([
                Self.deviceUUID, Self.challengeUUID, Self.commandUUID, Self.stateUUID
            ], for: service)
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, let characteristics = service.characteristics else { return }
        Task { @MainActor in
            for c in characteristics {
                switch c.uuid {
                case Self.deviceUUID:
                    deviceCharacteristic = c
                    peripheral.readValue(for: c)
                case Self.challengeUUID:
                    challengeCharacteristic = c
                    peripheral.setNotifyValue(true, for: c)
                    peripheral.readValue(for: c)
                case Self.commandUUID:
                    commandCharacteristic = c
                case Self.stateUUID:
                    stateCharacteristic = c
                    peripheral.setNotifyValue(true, for: c)
                    peripheral.readValue(for: c)
                default: break
                }
            }
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let value = characteristic.value, let text = String(data: value, encoding: .utf8) else { return }
        Task { @MainActor in
            switch characteristic.uuid {
            case Self.deviceUUID:
                connectedDeviceId = text
                updateNearby(peripheral: peripheral, rssi: 0, deviceId: text)
                if keyStore.key(for: text) == nil {
                    statusText = "Самокат \(text) не зарегистрирован в твоём парке"
                } else {
                    statusText = "\(text) авторизован"
                }
            case Self.challengeUUID:
                currentChallenge = text
            case Self.stateUUID:
                statusText = text == "OPEN" ? "Замок открыт" : text
                updateNearby(peripheral: peripheral, rssi: 0, state: text)
            default: break
            }
        }
    }
}

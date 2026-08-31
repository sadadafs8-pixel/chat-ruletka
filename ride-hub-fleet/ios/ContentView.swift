import SwiftUI

struct ContentView: View {
    @StateObject private var keyStore: FleetKeyStore
    @StateObject private var bluetooth: RideHubBluetoothManager

    init() {
        let store = FleetKeyStore()
        _keyStore = StateObject(wrappedValue: store)
        _bluetooth = StateObject(wrappedValue: RideHubBluetoothManager(keyStore: store))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Ride Hub Fleet")
                        .font(.largeTitle.bold())
                    Text(bluetooth.statusText)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack {
                    Button("Искать рядом") { bluetooth.startScan() }
                        .buttonStyle(.borderedProminent)
                    Button("Ближайший мой") { bluetooth.connectNearestAuthorized() }
                        .buttonStyle(.bordered)
                }

                List(bluetooth.nearby) { item in
                    Button {
                        bluetooth.connect(item)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.deviceId ?? item.name)
                                    .font(.headline)
                                Text(item.deviceId.flatMap { keyStore.key(for: $0)?.displayName } ?? item.state)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(item.rssi) dBm")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listStyle(.plain)

                if let id = bluetooth.connectedDeviceId {
                    VStack(spacing: 10) {
                        Text("Подключён: \(id)")
                            .font(.headline)
                        Button("Открыть самокат") {
                            bluetooth.unlock()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(keyStore.key(for: id) == nil)

                        Button("Отключиться") { bluetooth.disconnect() }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

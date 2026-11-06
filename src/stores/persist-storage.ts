import AsyncStorage from "@react-native-async-storage/async-storage";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

// AsyncStorage works on native (SQLite/RocksDB backed) and on web (localStorage
// backed via its web shim), so a single adapter covers every platform. We wrap
// it as a zustand-compatible StateStorage and expose a ready-to-use JSON
// storage for `persist({ storage })`.
const asyncStateStorage: StateStorage = {
  getItem: (name) => AsyncStorage.getItem(name),
  setItem: (name, value) => AsyncStorage.setItem(name, value),
  removeItem: (name) => AsyncStorage.removeItem(name),
};

export const persistStorage = createJSONStorage(() => asyncStateStorage);

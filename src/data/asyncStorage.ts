import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from './keyValueStore';

/**
 * The device-backed store. Isolated in its own file so that the repositories and
 * their tests never pull React Native into a Node process.
 */
export const asyncStorageKeyValueStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

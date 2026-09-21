import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * "View Original" (PRD §3.4, §33).
 *
 * Attribution is not decoration: the creator is the source of the workout, and the
 * user must always have an easy path back. We try the platform app first so TikTok or
 * Instagram opens natively, and fall back to an in-app browser.
 */
export async function openOriginal(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    const canOpenNatively = await Linking.canOpenURL(url);
    if (canOpenNatively) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Fall through to the in-app browser.
  }
  await WebBrowser.openBrowserAsync(url);
}

/**
 * "Find Demonstration" (PRD §15).
 *
 * An EXTERNAL search, clearly separated from creator-provided instruction. The UI
 * that calls this must never imply the result came from the original creator.
 */
export async function findDemonstration(exerciseName: string): Promise<void> {
  const query = encodeURIComponent(`${exerciseName} exercise form demonstration`);
  await WebBrowser.openBrowserAsync(`https://www.youtube.com/results?search_query=${query}`);
}

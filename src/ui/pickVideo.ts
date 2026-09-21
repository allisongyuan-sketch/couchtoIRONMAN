import * as ImagePicker from 'expo-image-picker';

/**
 * The upload fallback (PRD §19, §31).
 *
 * This is the path that always works. When a platform will not let us fetch a video
 * — which is the normal case for TikTok and Instagram — the user can still hand us
 * the file, and extraction proceeds exactly as it would have.
 */
export interface PickedVideo {
  uri: string;
  durationSeconds?: number;
}

export async function pickVideo(): Promise<PickedVideo | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    // Full quality: frames are downscaled later anyway, and re-encoding here would
    // only make burned-in text harder to read.
    quality: 1,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;

  const picked: PickedVideo = { uri: asset.uri };
  // The picker reports duration in milliseconds.
  if (asset.duration != null) picked.durationSeconds = asset.duration / 1000;
  return picked;
}

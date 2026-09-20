import { useEffect, useState } from 'react';
import { repositories } from './container';

/** Whether the three onboarding screens have been seen. Checked once, on Home. */
export function useOnboarding() {
  const [state, setState] = useState<{ checked: boolean; onboarded: boolean }>({
    checked: false,
    onboarded: true,
  });

  useEffect(() => {
    void repositories.preferences
      .hasOnboarded()
      .then((onboarded) => setState({ checked: true, onboarded }));
  }, []);

  return state;
}

export async function completeOnboarding(): Promise<void> {
  await repositories.preferences.setOnboarded(true);
}

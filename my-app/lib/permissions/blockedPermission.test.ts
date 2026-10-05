const mockAlert = jest.fn();
const mockOpenSettings = jest.fn(() => Promise.resolve());

jest.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  Linking: { openSettings: () => mockOpenSettings() },
}));

import { BLOCKED_PERMISSION_COPY, showBlockedPermission } from './blockedPermission';

type Button = { text: string; onPress?: () => void };

describe('blocked permission prompt', () => {
  it('offers a way to the settings page, and a way out', () => {
    showBlockedPermission('camera');
    const [title, , buttons] = mockAlert.mock.calls[0] as [string, string, Button[]];
    expect(title).toBe('Camera is off for Pawtchi');
    expect(buttons.map(b => b.text)).toEqual(['Not now', 'Open settings']);
    buttons[1].onPress?.();
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  it('keeps to the copy rules', () => {
    for (const { title, body } of Object.values(BLOCKED_PERMISSION_COPY)) {
      expect(`${title} ${body}`).not.toContain('!');
      expect(body.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
    }
  });
});

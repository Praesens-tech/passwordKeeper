import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App';
import { useVaultStore } from '../store/vaultStore';

vi.mock('../store/vaultStore', () => ({
  useVaultStore: vi.fn(),
}));

vi.mock('../components/MasterPasswordScreen', () => ({ MasterPasswordScreen: () => <div>Locked</div> }));
vi.mock('../components/Sidebar', () => ({ Sidebar: () => <aside>Sidebar</aside> }));
vi.mock('../components/PasswordGrid', () => ({ PasswordGrid: () => <main>Grid</main> }));
vi.mock('../components/AppMenuBar', () => ({ AppMenuBar: () => <nav>Menu</nav> }));
vi.mock('../components/PasswordForm', () => ({ PasswordForm: () => <div>Form</div> }));
vi.mock('../hooks/usePlatform', () => ({ usePlatform: () => ({ isAndroid: false }) }));

describe('App Component - Auto Lock', () => {
  const makeState = (overrides: Record<string, unknown> = {}) => ({
    isLocked: false,
    isDirty: false,
    isSyncing: false,
    syncError: null,
    vault: { entries: [], groups: [], sharedWith: [], deletionRequests: [], owner: 'test@example.com', version: '1.0' },
    localVaultPath: null,
    saveToLocalFile: vi.fn(),
    initFromStorage: vi.fn().mockResolvedValue(undefined),
    forceSync: vi.fn(),
    clearSyncError: vi.fn(),
    lockVault: vi.fn(),
    currentUserRole: vi.fn().mockReturnValue('owner'),
    ...overrides,
  });

  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    vi.useFakeTimers();
    state = makeState();
    vi.mocked(useVaultStore).mockImplementation(() => state as any);
    (useVaultStore as any).getState = vi.fn(() => state);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('should start with unlocked vault', () => {
    render(<App />);
    expect(useVaultStore).toHaveBeenCalled();
  });

  it('should lock vault after 5 minutes of inactivity', () => {
    render(<App />);

    act(() => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(state.lockVault).toHaveBeenCalled();
  });

  it('should reset inactivity timer on user activity', () => {
    render(<App />);

    act(() => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(4 * 60 * 1000);
      window.dispatchEvent(new Event('keypress'));
      vi.advanceTimersByTime(4 * 60 * 1000);
    });

    expect(state.lockVault).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(state.lockVault).toHaveBeenCalled();
  });

  it('should not start timer when vault is already locked', () => {
    state = makeState({ isLocked: true, lockVault: vi.fn() });
    vi.mocked(useVaultStore).mockImplementation(() => state as any);
    (useVaultStore as any).getState = vi.fn(() => state);

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(state.lockVault).not.toHaveBeenCalled();
  });

});

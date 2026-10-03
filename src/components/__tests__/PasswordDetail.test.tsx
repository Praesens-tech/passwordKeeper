import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PasswordDetail } from '../PasswordDetail';
import { useVaultStore } from '../../store/vaultStore';

vi.mock('../../store/vaultStore', () => ({
  useVaultStore: vi.fn(),
}));

describe('PasswordDetail Component', () => {
  const mockEntry = {
    id: 'test-id',
    name: 'Test Entry',
    username: 'testuser',
    password: 'testpass123',
    url: 'https://example.com',
    notes: 'Test notes',
    icon: 'test-icon',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(useVaultStore).mockReturnValue({
      vault: { entries: [mockEntry], groups: [], sharedWith: [], deletionRequests: [], owner: 'test@example.com', version: '1.0' },
      sharedSources: [],
      selectedEntryId: 'test-id',
      selectEntry: vi.fn(),
      deleteEntry: vi.fn(),
      toggleFavorite: vi.fn(),
      requestDeletion: vi.fn(),
      currentUserRole: vi.fn().mockReturnValue('owner'),
      userInfo: { email: 'test@example.com', name: 'Test User', picture: '' },
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render entry details', () => {
    render(<PasswordDetail />);

    expect(screen.getByText('Test Entry')).toBeInTheDocument();
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('Test notes')).toBeInTheDocument();
  });

  it('renders the group image without exposing its encoded contents', () => {
    const icon = 'data:image/jpeg;base64,dGVzdA==';
    const state = useVaultStore();
    vi.mocked(useVaultStore).mockReturnValue({
      ...state,
      vault: {
        ...state.vault,
        entries: [{ ...mockEntry, groupId: 'work' }],
        groups: [{ id: 'work', name: 'Work', icon }],
      },
    } as any);
    const { container } = render(<PasswordDetail />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(container.querySelector(`img[src="${icon}"]`)).toBeInTheDocument();
    expect(container.textContent).not.toContain('data:image/');
  });

  it('should copy username to clipboard', async () => {
    render(<PasswordDetail />);

    screen.getByTitle('Copiar usuário').click();

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('testuser');
    });
  });

  it('should copy password to clipboard', async () => {
    render(<PasswordDetail />);

    screen.getByTitle('Copiar senha').click();

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('testpass123');
    });
  });
});

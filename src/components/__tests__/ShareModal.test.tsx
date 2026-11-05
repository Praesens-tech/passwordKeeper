import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ShareModal } from '../ShareModal';
import { useVaultStore } from '../../store/vaultStore';

vi.mock('../../store/vaultStore', () => ({
  useVaultStore: vi.fn(),
}));

describe('ShareModal Component', () => {
  const mockVault = {
    entries: [{ id: '1', name: 'Test Entry', username: 'user', password: 'pass' }],
    groups: [],
    owner: 'owner@example.com',
    sharedWith: [],
    deletionRequests: [],
    version: '1.0',
  };

  const mockTarget = {
    id: '1',
    name: 'Test Entry',
    username: 'user',
    password: 'pass',
  } as any;

  const createSharedDocument = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.mocked(useVaultStore).mockReturnValue({
      vault: mockVault,
      firebaseAccount: { uid: 'owner-uid', email: 'owner@example.com', emailVerified: true },
      createSharedDocument,
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render share modal with correct title for entry type', () => {
    render(<ShareModal target={mockTarget} type="entry" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Compartilhar' })).toBeInTheDocument();
    expect(screen.getByText(/Senha: Test Entry/)).toBeInTheDocument();
    expect(screen.getByText('Senha de compartilhamento')).toBeInTheDocument();
  });

  it('should call createSharedDocument with correct params and show success screen', async () => {
    const onClose = vi.fn();
    render(<ShareModal target={mockTarget} type="entry" onClose={onClose} />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('destinatario@gmail.com'), {
        target: { value: 'dest@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Senha para abrir este cofre'), {
        target: { value: 'share-secret-123' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /compartilhar/i }));
    });

    await waitFor(() => {
      expect(createSharedDocument).toHaveBeenCalledWith({
        targetType: 'entry',
        targetId: '1',
        targetTitle: 'Test Entry',
        collaboratorEmail: 'dest@example.com',
        collaboratorRole: 'reader',
        sharePassword: 'share-secret-123',
      });
    });

    // Should show success screen
    expect(await screen.findByText('Compartilhado!')).toBeInTheDocument();
    expect(screen.getByText(/dest@example.com/)).toBeInTheDocument();
  });

  it('should show error screen when createSharedDocument throws', async () => {
    createSharedDocument.mockRejectedValueOnce(new Error('Firebase indisponível'));

    render(<ShareModal target={mockTarget} type="entry" onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('destinatario@gmail.com'), {
        target: { value: 'dest@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Senha para abrir este cofre'), {
        target: { value: 'senha123' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /compartilhar/i }));
    });

    expect(await screen.findByText('Erro ao compartilhar')).toBeInTheDocument();
    expect(screen.getByText(/Firebase indisponível/)).toBeInTheDocument();
  });

  it('should disable share button when no Firebase account is connected', () => {
    vi.mocked(useVaultStore).mockReturnValue({
      vault: mockVault,
      firebaseAccount: null,
      createSharedDocument,
    } as any);

    render(<ShareModal target={mockTarget} type="entry" onClose={vi.fn()} />);

    const shareBtn = screen.getByRole('button', { name: /compartilhar/i });
    expect(shareBtn).toBeDisabled();
  });
});

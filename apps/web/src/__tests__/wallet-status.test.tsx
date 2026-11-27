import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * Unit tests for the wallet connection status indicator in the navbar.
 *
 * These tests exercise the three required states:
 *  - disconnected: renders a "Connect Wallet" button
 *  - connected: renders a green dot + truncated address
 *  - pending/loading: renders a disabled placeholder
 *
 * They also cover the dropdown interactions (Copy Address / Disconnect)
 * and clipboard behaviour.
 */

// ---------------------------------------------------------------------------
// Mock Freighter helpers
// ---------------------------------------------------------------------------
// The app exposes installMockFreighter / uninstallMockFreighter helpers that
// attach a fake `window.freighter` (and related globals) used by the wallet
// context. We import them lazily so the module graph is set up after jsdom.
import {
  installMockFreighter,
  uninstallMockFreighter,
} from '../test-utils/mockFreighter';

// The component under test. It may be exported from the navbar module or a
// dedicated WalletStatus module; we try the dedicated one first.
import { WalletStatus } from '../components/WalletStatus';

// ---------------------------------------------------------------------------
// Clipboard mock
// ---------------------------------------------------------------------------
const FULL_ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TRUNCATED_ADDRESS = 'GABCDE...234567';

let clipboardWriteText: jest.Mock;

beforeEach(() => {
  // Reset persisted wallet state between tests.
  window.sessionStorage.clear();
  window.localStorage.clear();

  clipboardWriteText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });
});

afterEach(() => {
  uninstallMockFreighter();
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Disconnected state
// ---------------------------------------------------------------------------
describe('WalletStatus - disconnected state', () => {
  it('renders a Connect Wallet button when no wallet is connected', async () => {
    installMockFreighter({ connected: false });

    render(<WalletStatus />);

    const connectButton = await screen.findByRole('button', {
      name: /connect wallet/i,
    });
    expect(connectButton).toBeInTheDocument();
    expect(connectButton).toBeEnabled();
  });

  it('does not render the connected indicator when disconnected', async () => {
    installMockFreighter({ connected: false });

    render(<WalletStatus />);

    await screen.findByRole('button', { name: /connect wallet/i });
    expect(screen.queryByTestId('wallet-status-dot')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('wallet-status-address'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Connected state
// ---------------------------------------------------------------------------
describe('WalletStatus - connected state', () => {
  it('renders a green dot and the truncated address when connected', async () => {
    installMockFreighter({
      connected: true,
      address: FULL_ADDRESS,
    });

    render(<WalletStatus />);

    const dot = await screen.findByTestId('wallet-status-dot');
    expect(dot).toBeInTheDocument();
    // Green dot styling.
    expect(dot).toHaveStyle({ backgroundColor: 'green' });

    const address = screen.getByTestId('wallet-status-address');
    expect(address).toHaveTextContent(TRUNCATED_ADDRESS);
    // Full address should not be rendered in the navbar.
    expect(address).not.toHaveTextContent(FULL_ADDRESS);

    expect(
      screen.queryByRole('button', { name: /connect wallet/i }),
    ).not.toBeInTheDocument();
  });

  it('updates reactively within 500ms of a connect event', async () => {
    const mock = installMockFreighter({ connected: false });

    render(<WalletStatus />);

    await screen.findByRole('button', { name: /connect wallet/i });

    // Simulate the wallet emitting a connect event.
    act(() => {
      mock.emitConnect(FULL_ADDRESS);
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('wallet-status-address')).toHaveTextContent(
          TRUNCATED_ADDRESS,
        );
      },
      { timeout: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Pending / loading state
// ---------------------------------------------------------------------------
describe('WalletStatus - pending state', () => {
  it('renders a disabled placeholder while the connection is pending', async () => {
    installMockFreighter({ connected: false, pending: true });

    render(<WalletStatus />);

    const placeholder = await screen.findByTestId('wallet-status-pending');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toBeDisabled();

    // Neither the connect button nor the connected indicator should show.
    expect(
      screen.queryByRole('button', { name: /connect wallet/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('wallet-status-dot')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dropdown interactions
// ---------------------------------------------------------------------------
describe('WalletStatus - dropdown interactions', () => {
  async function renderConnected() {
    installMockFreighter({ connected: true, address: FULL_ADDRESS });
    render(<WalletStatus />);
    const address = await screen.findByTestId('wallet-status-address');
    return address;
  }

  it('opens a dropdown with Copy Address and Disconnect when clicking the address', async () => {
    const address = await renderConnected();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(address);

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /copy address/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /disconnect/i }),
    ).toBeInTheDocument();
  });

  it('returns to the disconnected state after clicking Disconnect', async () => {
    const address = await renderConnected();

    fireEvent.click(address);
    const disconnectItem = await screen.findByRole('menuitem', {
      name: /disconnect/i,
    });

    fireEvent.click(disconnectItem);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /connect wallet/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('wallet-status-dot')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('wallet-status-address'),
    ).not.toBeInTheDocument();
  });

  it('writes the full address to the clipboard when clicking Copy Address', async () => {
    const address = await renderConnected();

    fireEvent.click(address);
    const copyItem = await screen.findByRole('menuitem', {
      name: /copy address/i,
    });

    fireEvent.click(copyItem);

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWriteText).toHaveBeenCalledWith(FULL_ADDRESS);
  });
});
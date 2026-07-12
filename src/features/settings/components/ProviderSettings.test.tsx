import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '../../../types/api/model'
import { ProviderSettings } from './ProviderSettings'

const {
  authorizeProviderOAuthMock,
  completeProviderOAuthMock,
  connectProviderApiKeyMock,
  disconnectProviderMock,
  listProviderAuthMethodsMock,
  listProvidersMock,
} = vi.hoisted(() => ({
  authorizeProviderOAuthMock: vi.fn(),
  completeProviderOAuthMock: vi.fn(),
  connectProviderApiKeyMock: vi.fn(),
  disconnectProviderMock: vi.fn(),
  listProviderAuthMethodsMock: vi.fn(),
  listProvidersMock: vi.fn(),
}))

vi.mock('../../../api', () => ({
  authorizeProviderOAuth: authorizeProviderOAuthMock,
  completeProviderOAuth: completeProviderOAuthMock,
  connectProviderApiKey: connectProviderApiKeyMock,
  disconnectProvider: disconnectProviderMock,
  listProviderAuthMethods: listProviderAuthMethodsMock,
  listProviders: listProvidersMock,
}))

vi.mock('../../../hooks', () => ({ useCurrentDirectory: () => '/project' }))
vi.mock('../../../utils/tauri', () => ({ isTauri: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))

const provider = (id: string, name: string, source: Provider['source'] = 'api') =>
  ({ id, name, source, env: [], options: {}, models: { model: {} } }) as unknown as Provider

async function providerSection(name: string) {
  const section = (await screen.findByText(name)).closest('section')
  expect(section).not.toBeNull()
  return within(section!)
}

afterEach(() => cleanup())

describe('ProviderSettings workflows', () => {
  beforeEach(() => {
    authorizeProviderOAuthMock.mockReset()
    completeProviderOAuthMock.mockReset()
    connectProviderApiKeyMock.mockReset()
    disconnectProviderMock.mockReset()
    listProviderAuthMethodsMock.mockReset()
    listProvidersMock.mockReset()
    vi.spyOn(window, 'open').mockImplementation(() => null)
    listProviderAuthMethodsMock.mockResolvedValue({})
    connectProviderApiKeyMock.mockResolvedValue(true)
    completeProviderOAuthMock.mockResolvedValue(true)
    disconnectProviderMock.mockResolvedValue(true)
  })

  it('connects an available provider with an API key and refreshes the list', async () => {
    listProvidersMock
      .mockResolvedValueOnce({ all: [provider('alpha', 'Alpha')], connected: [], default: {} })
      .mockResolvedValueOnce({ all: [provider('alpha', 'Alpha')], connected: ['alpha'], default: {} })
    listProviderAuthMethodsMock.mockResolvedValue({ alpha: [{ type: 'api', label: 'API key' }] })

    render(<ProviderSettings />)
    fireEvent.click((await providerSection('Alpha')).getByRole('button', { name: 'Connect' }))
    fireEvent.change(screen.getByPlaceholderText('API key'), { target: { value: 'secret' } })
    fireEvent.click(
      within(screen.getByText('Connect Alpha').closest('section')!).getByRole('button', { name: 'Connect' }),
    )

    await waitFor(() => expect(connectProviderApiKeyMock).toHaveBeenCalledWith('alpha', 'secret', '/project'))
    await waitFor(() => expect(listProvidersMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('completes code OAuth authorization and refreshes the list', async () => {
    listProvidersMock.mockResolvedValue({ all: [provider('beta', 'Beta')], connected: [], default: {} })
    listProviderAuthMethodsMock.mockResolvedValue({ beta: [{ type: 'oauth', label: 'OAuth' }] })
    authorizeProviderOAuthMock.mockResolvedValue({
      url: 'https://auth.test/code',
      method: 'code',
      instructions: 'Paste the code',
    })

    render(<ProviderSettings />)
    fireEvent.click((await providerSection('Beta')).getByRole('button', { name: 'Connect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Authorize in browser' }))
    fireEvent.change(await screen.findByPlaceholderText('Authorization code'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))

    await waitFor(() => expect(authorizeProviderOAuthMock).toHaveBeenCalledWith('beta', 0, {}, '/project'))
    await waitFor(() => expect(completeProviderOAuthMock).toHaveBeenCalledWith('beta', 0, '1234', '/project'))
    expect(window.open).toHaveBeenCalledWith('https://auth.test/code', '_blank', 'noopener,noreferrer')
  })

  it('completes automatic OAuth callback and refreshes the list', async () => {
    listProvidersMock.mockResolvedValue({ all: [provider('gamma', 'Gamma')], connected: [], default: {} })
    listProviderAuthMethodsMock.mockResolvedValue({ gamma: [{ type: 'oauth', label: 'Device OAuth' }] })
    authorizeProviderOAuthMock.mockResolvedValue({
      url: 'https://auth.test/auto',
      method: 'auto',
      instructions: 'Code: ABCD',
    })

    render(<ProviderSettings />)
    fireEvent.click((await providerSection('Gamma')).getByRole('button', { name: 'Connect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Authorize in browser' }))

    await waitFor(() => expect(completeProviderOAuthMock).toHaveBeenCalledWith('gamma', 0, undefined, '/project'))
    await waitFor(() => expect(listProvidersMock).toHaveBeenCalledTimes(2))
    expect(window.open).toHaveBeenCalledWith('https://auth.test/auto', '_blank', 'noopener,noreferrer')
  })

  it('disconnects a connected provider and refreshes the list', async () => {
    listProvidersMock
      .mockResolvedValueOnce({ all: [provider('delta', 'Delta')], connected: ['delta'], default: {} })
      .mockResolvedValueOnce({ all: [provider('delta', 'Delta')], connected: [], default: {} })

    render(<ProviderSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(disconnectProviderMock).toHaveBeenCalledWith('delta', '/project'))
    await waitFor(() => expect(listProvidersMock).toHaveBeenCalledTimes(2))
    expect((await providerSection('Delta')).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })
})

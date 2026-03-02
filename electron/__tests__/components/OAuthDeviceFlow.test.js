import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { App as AntApp } from "antd";
import OAuthDeviceFlow from "../../src/components/OAuthDeviceFlow";

function renderWithAntd(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

describe("OAuthDeviceFlow", () => {
  let mockStartOAuthDeviceFlow;
  let oauthProgressCallback;
  let cleanupFn;

  beforeEach(() => {
    mockStartOAuthDeviceFlow = jest.fn();
    cleanupFn = jest.fn();
    oauthProgressCallback = null;

    window.electronAPI = {
      startOAuthDeviceFlow: mockStartOAuthDeviceFlow,
      onOAuthProgress: jest.fn((cb) => {
        oauthProgressCallback = cb;
        return cleanupFn;
      }),
    };

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    delete window.electronAPI;
    jest.restoreAllMocks();
  });

  test("renders idle state with authorize button", async () => {
    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    expect(screen.getByTestId("start-oauth-btn")).toBeInTheDocument();
    expect(screen.getByText("Authorize with OAuth")).toBeInTheDocument();
  });

  test("transitions to pending state after clicking authorize", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: true,
      verificationUri: "https://gitlab.com/oauth/authorize",
      userCode: "ABCD-1234",
      verificationUriComplete:
        "https://gitlab.com/oauth/authorize?code=ABCD-1234",
    });

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-pending")).toBeInTheDocument();
    });

    expect(screen.getByTestId("oauth-user-code")).toHaveTextContent(
      "ABCD-1234",
    );
    expect(screen.getByTestId("oauth-link")).toBeInTheDocument();
    expect(screen.getByText("Waiting for authorization...")).toBeInTheDocument();
  });

  test("shows error state when start fails", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: false,
      error: "OAuth Client ID is required",
    });

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-error")).toBeInTheDocument();
    });

    expect(
      screen.getByText("OAuth Client ID is required"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("oauth-retry-btn")).toBeInTheDocument();
  });

  test("shows success state when oauth-progress receives success", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: true,
      verificationUri: "https://gitlab.com/oauth/authorize",
      userCode: "ABCD-1234",
      verificationUriComplete: "",
    });

    const onSuccess = jest.fn();

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={onSuccess} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-pending")).toBeInTheDocument();
    });

    // Simulate success from main process
    await act(async () => {
      oauthProgressCallback({ status: "success", token: "test-token-abc" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-success")).toBeInTheDocument();
    });

    expect(onSuccess).toHaveBeenCalledWith("test-token-abc");
  });

  test("shows error state when oauth-progress receives error", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: true,
      verificationUri: "https://gitlab.com/oauth/authorize",
      userCode: "ABCD-1234",
      verificationUriComplete: "",
    });

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-pending")).toBeInTheDocument();
    });

    // Simulate error from main process
    await act(async () => {
      oauthProgressCallback({
        status: "error",
        message: "Device authorization expired",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-error")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Device authorization expired"),
    ).toBeInTheDocument();
  });

  test("retry button restarts the flow after error", async () => {
    mockStartOAuthDeviceFlow
      .mockResolvedValueOnce({
        success: false,
        error: "Network error",
      })
      .mockResolvedValueOnce({
        success: true,
        verificationUri: "https://gitlab.com/oauth/authorize",
        userCode: "RETRY-CODE",
        verificationUriComplete: "",
      });

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    // First attempt fails
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-error")).toBeInTheDocument();
    });

    // Retry
    await act(async () => {
      fireEvent.click(screen.getByTestId("oauth-retry-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-pending")).toBeInTheDocument();
    });

    expect(screen.getByTestId("oauth-user-code")).toHaveTextContent(
      "RETRY-CODE",
    );
    expect(mockStartOAuthDeviceFlow).toHaveBeenCalledTimes(2);
  });

  test("copy button copies user code to clipboard", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: true,
      verificationUri: "https://gitlab.com/oauth/authorize",
      userCode: "COPY-ME",
      verificationUriComplete: "",
    });

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("copy-code-btn")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-code-btn"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("COPY-ME");
  });

  test("cleans up oauth-progress listener on unmount", async () => {
    mockStartOAuthDeviceFlow.mockResolvedValue({
      success: true,
      verificationUri: "https://gitlab.com/oauth/authorize",
      userCode: "TEST",
      verificationUriComplete: "",
    });

    let unmount;
    await act(async () => {
      const result = renderWithAntd(
        <OAuthDeviceFlow onSuccess={jest.fn()} />,
      );
      unmount = result.unmount;
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-pending")).toBeInTheDocument();
    });

    act(() => {
      unmount();
    });

    expect(cleanupFn).toHaveBeenCalled();
  });

  test("handles missing electronAPI gracefully", async () => {
    delete window.electronAPI;

    await act(async () => {
      renderWithAntd(<OAuthDeviceFlow onSuccess={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-oauth-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("oauth-error")).toBeInTheDocument();
    });

    expect(screen.getByText("electronAPI not available")).toBeInTheDocument();
  });
});

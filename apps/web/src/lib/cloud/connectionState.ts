export type CloudConnectionStatus = "unchecked" | "connecting" | "connected" | "offline" | "error";

export type CloudConnectionState = {
  status: CloudConnectionStatus;
  latestRequestId: number;
  pendingRequests: number;
};

export const initialCloudConnectionState = (): CloudConnectionState => ({
  status: "unchecked",
  latestRequestId: 0,
  pendingRequests: 0,
});

export function cloudConnectionLabel(status: CloudConnectionStatus) {
  return {
    unchecked: "未檢查",
    connecting: "連線中",
    connected: "已連線",
    offline: "離線",
    error: "連線異常",
  }[status];
}

export function beginCloudRequest(state: CloudConnectionState, browserOnline: boolean) {
  const requestId = state.latestRequestId + 1;
  if (!browserOnline) {
    return {
      requestId,
      state: { ...state, latestRequestId: requestId, status: "offline" as const },
      shouldRequest: false,
    };
  }
  return {
    requestId,
    state: {
      status: "connecting" as const,
      latestRequestId: requestId,
      pendingRequests: state.pendingRequests + 1,
    },
    shouldRequest: true,
  };
}

export function finishCloudRequest(
  state: CloudConnectionState,
  requestId: number,
  browserOnline: boolean,
  succeeded: boolean,
): CloudConnectionState {
  const pendingRequests = Math.max(0, state.pendingRequests - 1);
  if (requestId !== state.latestRequestId) return { ...state, pendingRequests };
  return {
    ...state,
    pendingRequests,
    status: !browserOnline ? "offline" : succeeded ? "connected" : "error",
  };
}

export function browserConnectionChanged(state: CloudConnectionState, browserOnline: boolean): CloudConnectionState {
  if (!browserOnline) return { ...state, status: "offline" };
  return { ...state, status: state.pendingRequests > 0 ? "connecting" : "unchecked" };
}

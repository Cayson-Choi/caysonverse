import { Component, type ReactNode } from "react";
import { getRoom } from "../net/connection";
import { CRASH_COPY, leaveAfterCrash } from "./crash";
import "./crash.css";

/**
 * 앱 전체 오류 경계(입장 화면과 마을을 감싼다). 잡지 못한 렌더 오류가 나면 React가 루트를 통째로 지워 빈
 * 화면만 남는데, 그 대신 새로고침 안내를 띄운다. 3D 장면(R3F Canvas) 안의 오류도 Canvas가 바깥으로 다시 던지므로
 * 여기서 잡힌다. 열린 방이 있으면 나가서, 다른 사람에게 멈춘 아바타가 남지 않게 한다. 한 번 뜨면 새로고침할 때까지 그대로다(나간 뒤 재접속 장치가 화면을 입장으로 돌려도 이 안내를 둔다).
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  componentDidCatch(): void {
    // React가 잡은 오류를 콘솔에 이미 남긴다. 여기서는 방만 나간다.
    leaveAfterCrash(getRoom());
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="cv-crash" role="alert">
        <div className="cv-crash-card">
          <p className="cv-crash-text">{CRASH_COPY.message}</p>
          <button type="button" className="cv-crash-reload" onClick={() => window.location.reload()}>
            {CRASH_COPY.reload}
          </button>
        </div>
      </div>
    );
  }
}

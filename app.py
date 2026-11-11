"""Open the Pomodoro timer in its own desktop window."""

from __future__ import annotations

import socket
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "web"


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class DesktopApi:
    def __init__(self):
        self.window = None

    def set_on_top(self, enabled):
        if self.window is not None:
            self.window.on_top = bool(enabled)
        return True

    def set_title(self, title):
        if self.window is not None and isinstance(title, str) and title.strip():
            self.window.set_title(title.strip()[:80])
        return True


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve() -> tuple[ThreadingHTTPServer, str]:
    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}/"


def tell(message: str) -> None:
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    messagebox.showerror("番茄钟", message)
    root.destroy()


def open_browser(url: str) -> None:
    webbrowser.open(url)
    import tkinter as tk

    root = tk.Tk()
    root.title("番茄钟")
    root.geometry("320x120")
    root.resizable(False, False)
    label = tk.Label(root, text="番茄钟已在浏览器中打开。\n关闭此窗口即退出。", pady=16)
    label.pack()
    root.mainloop()


def main() -> None:
    if not (ROOT / "index.html").is_file():
        tell("找不到界面文件，请确认 web 文件夹还在。")
        return

    server, url = serve()
    try:
        import webview
    except ImportError:
        open_browser(url)
        server.shutdown()
        return

    api = DesktopApi()
    window = webview.create_window(
        "番茄钟",
        url,
        js_api=api,
        width=440,
        height=740,
        min_size=(380, 640),
        background_color="#100E0C",
        private_mode=False,
    )
    api.window = window
    try:
        webview.start()
    except Exception as exc:
        tell(f"桌面窗口打不开：{exc}")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()

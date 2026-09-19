#!/usr/bin/env python3
"""Deterministic Unix-socket relay fixture for live-state authority tests."""

import json
import os
import socket
import sys
import time


class LineFrameReader:
    def __init__(self, connection: socket.socket) -> None:
        self.connection = connection
        self.buffer = bytearray()

    def read_line(self) -> bytes:
        while True:
            newline = self.buffer.find(b"\n")
            if newline >= 0:
                end = newline + 1
                frame = bytes(self.buffer[:end])
                del self.buffer[:end]
                return frame
            chunk = self.connection.recv(4096)
            if not chunk:
                frame = bytes(self.buffer)
                self.buffer.clear()
                return frame
            self.buffer.extend(chunk)


def server(socket_path: str, behavior: str, marker_path: str) -> None:
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(socket_path)
    listener.listen(16)
    while True:
        connection, _ = listener.accept()
        with connection:
            reader = LineFrameReader(connection)
            request = json.loads(reader.read_line())
            with open(marker_path, "a", encoding="utf-8") as marker:
                marker.write(f"{behavior}-handshake {' '.join(request)}\n")
            connection.sendall(b"Handshake OK\n")
            if behavior == "stale":
                time.sleep(30)
                continue
            command = request[:2]
            if command == ["terminal", "list"]:
                result = {
                    "terminals": [
                        {
                            "tabId": os.environ["ORCA_FIXTURE_TAB"],
                            "connected": True,
                            "handle": os.environ["ORCA_FIXTURE_HANDLE"],
                        }
                    ]
                }
            elif command == ["terminal", "wait"]:
                result = {"wait": {"satisfied": True}}
            elif command == ["terminal", "read"]:
                result = {"terminal": {"tail": []}}
            elif command == ["terminal", "send"]:
                result = {}
            else:
                result = {}
            connection.sendall(
                (json.dumps({"ok": True, "result": result}) + "\n").encode()
            )


def client(arguments: list[str]) -> None:
    relay_dir = os.environ.get("ORCA_RELAY_DIR")
    if relay_dir:
        socket_path = os.path.join(relay_dir, "relay.sock")
    else:
        socket_path = os.environ.get("ORCA_RELAY_SOCKET_PATH") or os.environ[
            "ORCA_FIXTURE_LIVE_SOCKET"
        ]
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.connect(socket_path)
    with connection:
        reader = LineFrameReader(connection)
        connection.sendall((json.dumps(arguments) + "\n").encode())
        reader.read_line()
        response = reader.read_line()
    if response:
        sys.stdout.buffer.write(response)


def frame_test() -> int:
    expected_handshake = b"Handshake OK\n"
    expected_response = b'{"ok": true}\n'
    sender, receiver = socket.socketpair()
    with sender, receiver:
        sender.sendall(expected_handshake + expected_response)
        sender.shutdown(socket.SHUT_WR)
        reader = LineFrameReader(receiver)
        observed_handshake = reader.read_line()
        observed_response = reader.read_line()
    if (observed_handshake, observed_response) == (
        expected_handshake,
        expected_response,
    ):
        return 0
    sys.stderr.write(
        "frame-test: expected "
        f"{(expected_handshake, expected_response)!r}, observed "
        f"{(observed_handshake, observed_response)!r}\n"
    )
    return 1


if len(sys.argv) >= 2 and sys.argv[1] == "frame-test":
    raise SystemExit(frame_test())
if len(sys.argv) >= 2 and sys.argv[1] == "server":
    server(sys.argv[2], sys.argv[3], sys.argv[4])
else:
    client(sys.argv[1:])

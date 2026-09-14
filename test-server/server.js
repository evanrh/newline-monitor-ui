import net from "node:net";

const PORT = 6688;

const CONTROL_CODE_PREFIX = Buffer.from([
  0x7F, 0x08, 0x99, 0xA2, 0xB3, 0xC4, 0x02, 0xFF
]);

const CONTROL_CODE_ENDING_BYTE = 0xCF;

const REQUEST_LENGTH = 11;
const RESPONSE_LENGTH = 12;

class DeviceState {
  power = true;
  muted = false;
  volume = 50;
  displayMode = 0;
  backlightBrightness = 100;
  backlightOn = true;
  sleep = false;
  signalSource = 0x19;
  backlightToggleState = true;

  reset() {
    this.power = true;
    this.muted = false;
    this.volume = 50;
    this.displayMode = 0;
    this.backlightBrightness = 100;
    this.backlightOn = true;
    this.sleep = false;
    this.signalSource = 0x19;
    this.backlightToggleState = true;
  }
}

function makeMessage(bytes) {
  return Buffer.from([
    ...CONTROL_CODE_PREFIX,
    ...bytes,
    CONTROL_CODE_ENDING_BYTE
  ]);
}

function makeControlResponse(command) {
  return makeMessage([
    command[0],
    command[1],
    0x01
  ]);
}

function makeQueryResponse(query, result) {
  return makeMessage([
    query[0],
    query[1],
    result
  ]);
}

function handleCommand(command, state) {
  const [type, value] = command;

  if (type === 0x01 && value === 0x01) {
    state.power = false;
    state.sleep = false;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x04) {
    state.sleep = true;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x03) {
    state.sleep = false;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x02) {
    state.muted = !state.muted;
    return makeControlResponse(command);
  }

  if (type === 0x0F && value === 0x00) {
    state.muted = true;
    return makeControlResponse(command);
  }

  if (type === 0x0F && value === 0x01) {
    state.muted = false;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x0A) {
    state.signalSource = 0x19;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x52) {
    state.signalSource = 0x1F;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x53) {
    state.signalSource = 0x1E;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x17) {
    state.volume = Math.max(0, state.volume - 1);
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x18) {
    state.volume = Math.min(100, state.volume + 1);
    return makeControlResponse(command);
  }

  if (type === 0x05) {
    state.volume = Math.max(0, Math.min(100, value));
    return makeControlResponse(command);
  }

  if (type === 0x0E && value === 0x01) {
    state.backlightOn = true;
    return makeControlResponse(command);
  }

  if (type === 0x0E && value === 0x00) {
    state.backlightOn = false;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x15) {
    state.backlightToggleState = !state.backlightToggleState;
    state.backlightOn = state.backlightToggleState;

    return makeMessage([
      type,
      value,
      state.backlightToggleState ? 0x01 : 0x00
    ]);
  }

  if (type === 0x06) {
    state.displayMode = value;
    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x47) {
    state.backlightBrightness =
      Math.min(100, state.backlightBrightness + 1);

    return makeControlResponse(command);
  }

  if (type === 0x01 && value === 0x48) {
    state.backlightBrightness =
      Math.max(0, state.backlightBrightness - 1);

    return makeControlResponse(command);
  }

  if (
    type === 0x01 &&
    [
      0x06,
      0x09,
      0x1B,
      0x1C,
      0x1D,
      0x20,
      0x2B,
      0x2C,
      0x2D,
      0x2E,
      0x2F
    ].includes(value)
  ) {
    return makeControlResponse(command);
  }

  if (
    (type === 0x00 || type === 0x01) &&
    (value === 0x0D || value === 0x0F)
  ) {
    return makeControlResponse(command);
  }

  if (type === 0x0A && value === 0x00) {
    state.reset();
    return makeControlResponse(command);
  }

  return null;
}

function handleQuery(query, state) {
  const [type, value] = query;

  if (type !== 0x01) {
    return null;
  }

  if (value === 0x37) {
    return makeQueryResponse(
      query,
      state.power ? 0x01 : 0x00
    );
  }

  if (value === 0x82) {
    return makeQueryResponse(
      query,
      state.muted ? 0x01 : 0x00
    );
  }

  if (value === 0x50) {
    return makeQueryResponse(
      query,
      state.signalSource
    );
  }

  if (value === 0x33) {
    return makeQueryResponse(
      query,
      state.volume
    );
  }

  if (value === 0x35) {
    return makeQueryResponse(
      query,
      state.displayMode
    );
  }

  if (value === 0x49) {
    return makeQueryResponse(
      query,
      state.backlightBrightness
    );
  }

  if (value === 0x81) {
    return makeQueryResponse(
      query,
      state.backlightOn ? 0x00 : 0x01
    );
  }

  if (value === 0x45) {
    return makeQueryResponse(
      query,
      state.sleep ? 0x01 : 0x00
    );
  }

  return null;
}

function parseMessage(message) {
  if (message.length !== REQUEST_LENGTH) {
    throw new Error(
      `Invalid message length: ${message.length}`
    );
  }

  if (
    !message
      .subarray(0, CONTROL_CODE_PREFIX.length)
      .equals(CONTROL_CODE_PREFIX)
  ) {
    throw new Error("Invalid prefix");
  }

  if (
    message[REQUEST_LENGTH - 1] !==
    CONTROL_CODE_ENDING_BYTE
  ) {
    throw new Error("Invalid ending byte");
  }

  return [
    message[8],
    message[9]
  ];
}

const queryCodes = new Set([
  "01:37",
  "01:82",
  "01:50",
  "01:33",
  "01:35",
  "01:49",
  "01:81",
  "01:45"
]);

const server = net.createServer((socket) => {
  const state = new DeviceState();
  let buffer = Buffer.alloc(0);

  socket.setKeepAlive(true);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= REQUEST_LENGTH) {
      const message = buffer.subarray(0, REQUEST_LENGTH);
      buffer = buffer.subarray(REQUEST_LENGTH);

      try {
        const command = parseMessage(message);

        console.log(
          "RX:",
          message.toString("hex")
        );

        const key = command
          .map((byte) =>
            byte.toString(16).padStart(2, "0")
          )
          .join(":");

        const response = queryCodes.has(key)
          ? handleQuery(command, state)
          : handleCommand(command, state);

        if (!response) {
          throw new Error(
            `Unknown command: ${message.toString("hex")}`
          );
        }

        if (response.length !== RESPONSE_LENGTH) {
          throw new Error(
            `Invalid response length: ${response.length}`
          );
        }

        console.log(
          "TX:",
          response.toString("hex")
        );

        socket.write(response);
      } catch (error) {
        console.error(error.message);
        socket.destroy();
        return;
      }
    }
  });

  socket.on("error", (error) => {
    console.error(error.message);
  });

  socket.on("close", () => {
    console.log("Client disconnected");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NewLine test server listening on ${PORT}`);
});


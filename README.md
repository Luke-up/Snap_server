# Snap Game Backend

This is the backend server for the **Snap game**.  
The server handles real-time gameplay and chat functionality using **WebSockets** via **Socket.io**.

## Running Locally

To run this server locally, you'll need to clone the repository:

```bash
git clone https://github.com/Luke-up/Snap_server
cd Snap_server
npm install
npm start:dev
```

This backend is designed to work with the Snap game frontend:

Frontend repo: https://github.com/Luke-up/Snap_app

## Features

**WebSocket Communication**: Facilitates real-time multiplayer functionality.

**Room Management**: Players can create and join rooms with unique IDs.

**Game State Handling**: Manages player actions, game flow, and scoring logic.

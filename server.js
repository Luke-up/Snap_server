const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = {};

// Generate card options
let allCards = [];
const cardsFilePath = path.join(__dirname, 'cards.json');
fs.readFile(cardsFilePath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading cards.json:', err);
    return;
  }
  try {
    allCards = JSON.parse(data);
    console.log('Cards loaded:', allCards);
  } catch (parseErr) {
    console.error('Error parsing cards.json:', parseErr);
  }
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('createRoom', (settings) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      settings,
      users: [socket.id],
      gameState: {
        readyUsers: [],
      },
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, settings });
    console.log(`Room created with ID: ${roomId} by user: ${socket.id}, user add = ${rooms[roomId].users}`);
  });

  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && rooms[roomId].users.length < 5) {
      socket.join(roomId);
      rooms[roomId].users.push(socket.id);
      socket.emit('roomJoined', { roomId, settings: rooms[roomId].settings });
    } else {
      socket.emit('roomFull', { message: 'Room is full or does not exist' });
    }
  });

  // Handle the snap event
  socket.on('snap', (data) => {
    const roomId = getRoomId(socket);
    console.log('roomId:', roomId);
    if (roomId) {
      io.to(roomId).emit('snap', { message: 'A user spies a snap!', data });
    }
  });

  // Handle the chat event
  socket.on('chat', (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      
      const cardcase = generateCardArray(allCards, rooms[roomId].settings, rooms[roomId].users.length)
      console.log('cardcase:', cardcase);
      socket.broadcast.to(roomId).emit('chat', { message: `${data.name}: ${data.chat}: ${cardcase}`, data });
      socket.emit('chatResponse', { message: `You: ${data.chat}`, data });
    }
  });

  // Handle the ready event
  socket.on('ready', (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      rooms[roomId].gameState.readyUsers.push(socket.id);
      socket.broadcast.to(roomId).emit('ready', { message: `${data.name} is ready!`, data });
      socket.emit('ready', { message: `You are ready!`, data });
      if (rooms[roomId].gameState.readyUsers.length === rooms[roomId].users.length) {
        console.log('All users ready');
        startGame(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.users = room.users.filter((id) => id !== socket.id);
      if (room.users.length === 0) {
        delete rooms[roomId];
      }
    }
    console.log('user disconnected');
  });
});

const startGame = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  const { users, settings } = room;
  const cards = generateCardArray(allCards, settings, users.length);
  console.log('cards:', cards);

  users.forEach((userId, index) => {
    const userCard = cards[index];
    const remainingCards = cards.filter((_, i) => i !== index);

    // Send the user's card and the remaining cards
    io.to(userId).emit('receiveCards', { userCard, remainingCards });
  });

  io.in(roomId).emit('gameStarted');
};

const generateCardArray = (cards, settings, userCount) => {
  console.log(cards);
  console.log(settings);
  console.log(userCount);
  let cardOptionsArray = [];
  let categoryUnSet = true;

  Object.keys(settings).forEach((category) => {
    if (settings[category]) {
      console.log(category);
      categoryUnSet = false;
      cardOptionsArray = cardOptionsArray.concat(cards.filter(card => card.category === category));
    } 
  });
  if (categoryUnSet) {
    cardOptionsArray = cards;
  }

  const options = [];
  // Determine if we should include a matching pair (30% chance)
  const includeMatchingPair = Math.random() < 0.3;
  // Set the initial length to one less if we plan to add a matching pair
  const initialLength = includeMatchingPair ? userCount - 1 : userCount;

  for (let i = 0; i < initialLength; i++) {
    const randomIndex = Math.floor(Math.random() * cardOptionsArray.length);
    const hintType = Math.floor(Math.random() * 3) + 1;
    if (i === 0 && includeMatchingPair) {
      const hintType2 = hintType === 1 ? 3 : hintType === 3 ? 2 : 1;
      const randomExtraCard = {
        category: cardOptionsArray[randomIndex].category, 
        value: cardOptionsArray[randomIndex].value, 
        hint: hintType2
      };
      options.push(randomExtraCard);
    }
    const randomCard = {
      category: cardOptionsArray[randomIndex].category, 
      value: cardOptionsArray[randomIndex].value, 
      hint: hintType
    };
    options.push(randomCard);
  }

  return options;
};

// Function to generate a unique room ID
function generateRoomId() {
  return Math.random().toString(36).substr(2, 9);
}

// Function to get the room ID of a user
function getRoomId(socket) {
  for (const roomId in rooms) {
    if (rooms[roomId].users.includes(socket.id)) {
      return roomId;
    }
  }
  return null;
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

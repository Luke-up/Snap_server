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
      settings: settings.categories,
      users: [socket.id],
      gameState: {
        readyUsers: [],
        loserUsers: [],
        cards: [],
        match: false,
      },
      scoreCard: {
        [socket.id]:{
          name: settings.name,
          score: 0,
        }
      },
    };
    socket.join(roomId);
    socket.emit('roomCreated', {scoreCard: rooms[roomId].scoreCard, roomId, settings });
    console.log(`Room created with ID: ${roomId} by user: ${socket.id}, user add = ${rooms[roomId].users}`);
  });

  socket.on('joinRoom', (joinSettings) => {
    const roomId = joinSettings.roomId;
    if (rooms[roomId] && rooms[roomId].users.length < 5) {
      socket.join(roomId);
      rooms[roomId].users.push(socket.id);
      rooms[roomId].scoreCard[socket.id] = {
        name: joinSettings.name,
        score: 0,
      };
      
      socket.broadcast.to(roomId).emit('playerJoined', { scoreCard: rooms[roomId].scoreCard, message: `${joinSettings.name} has logged on` });
      console.log(`User joined room = ${roomId}`);
      socket.emit('roomJoined', { scoreCard: rooms[roomId].scoreCard });
    } else {
      socket.emit('roomFull', { message: 'Room is full or does not exist' });
    }
  });

  // Handle the snap event
  socket.on('action', (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      if (data.action === "ready") {
        handleReady(roomId, socket, data);
      }
      if (data.action === "snap") {
        handleSnap(roomId, socket, data);
      }
      if (data.action === "noSnap") {
        handleNoSnap(roomId, socket, data);
      }
      if (data.action === "cardSelect") {
        handleSelectCards(roomId, socket, data);
      }
      if (data.action === "logout") {
        rooms[roomId].users = rooms[roomId].users.filter(userId => userId !== socket.id);
        delete rooms[roomId].scoreCard[socket.id];
        if (rooms[roomId].users.length === 0) {
          delete rooms[roomId];
        } else if (rooms[roomId].users.length >= 1) {
          socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} has logged out`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
        }
      }
    }
  });

  // Handle the chat event
  socket.on('chat', (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      socket.broadcast.to(roomId).emit('chat', { message: `${data.name}: ${data.chat}`, data });
      socket.emit('chat', { message: `You: ${data.chat}`, data });
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

// Handle the ready event
const handleReady = (roomId, socket, data) => {
  rooms[roomId].gameState.readyUsers.push(socket.id);
  if (rooms[roomId].gameState.readyUsers.length === rooms[roomId].users.length) {
    socket.broadcast.to(roomId).emit('chat', { message: `All users ready`, data });
    socket.emit('gamePlay', { message: `You are ready!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} })
    startGame(roomId);
  } else {
    socket.broadcast.to(roomId).emit('chat', { message: `${data.name} is ready!`, data });
    socket.emit('gamePlay', { message: `You are ready!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} });
  }
};

const handleSnap = (roomId, socket, data) => {
  socket.broadcast.to(roomId).emit('gamePlay', { message: `${data.name} spies a snap!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: true, gameLoser: false, gameCheck: false} });
  socket.emit('gamePlay', { message: `You called a snap you goose, hurry!`, state: {lobby: false, countDown: false, inGame: false, gameHero: true, gameObserver: false, gameLoser: false, gameCheck: false} });
}

const handleNoSnap = (roomId, socket, data) => {
  socket.broadcast.to(roomId).emit('gamePlay', { message: `${data.name} declares no matches!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} });
  socket.emit('gamePlay', { message: `You just said there were no matches!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} });
  setTimeout(() => {
    if(! rooms[roomId].gameState.match) {
      rooms[roomId].scoreCard[socket.id].score += 1;
      socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `You were right, there are no matches!`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
      socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} was right, there are no matches!`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
      rooms[roomId].gameState.loserUsers = [];
    } else if (rooms[roomId].gameState.loserUsers && rooms[roomId].gameState.loserUsers.length === rooms[roomId].users.length - 1) {
      rooms[roomId].scoreCard[socket.id].score -= 0.5;
      socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `You were wong, there was a match! Looks like nobody wins this round.`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
      socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} was wrong, there is a match! Looks like nobody wins this round.`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
      rooms[roomId].gameState.loserUsers = [];
    } else {
      rooms[roomId].scoreCard[socket.id].score -= 0.5;
      socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `You were wrong, there was a match!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
      socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} was wrong, there is a match!`, state: {lobby: false, countDown: false, inGame: true, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
      rooms[roomId].gameState.loserUsers.push(socket.id);
    }
  }, 2000);
  
}

const handleSelectCards = (roomId, socket, data) => {
  socket.broadcast.to(roomId).emit('gamePlay', { state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} });
  socket.emit('gamePlay', { state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: true} });
  if (data.cards[0].card === data.cards[1].card) {
    rooms[roomId].scoreCard[socket.id].score += 1;
    socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `Yes! It's a match`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
    socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} was right, they found a match!`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
    rooms[roomId].gameState.loserUsers = [];
  } else if (rooms[roomId].gameState.loserUsers && rooms[roomId].gameState.loserUsers.length === rooms[roomId].users.length - 1) {
    rooms[roomId].scoreCard[socket.id].score -= 0.5;
    socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `You were wrong, these are not matches! Looks like nobody wins this round.`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
    socket.broadcast.to(roomId).emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `${data.name} couldn't find a matching pair! Looks like nobody wins this round.`, state: {lobby: true, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
    rooms[roomId].gameState.loserUsers = [];
  } else {
    rooms[roomId].scoreCard[socket.id].score -= 0.5;
    socket.emit('gamePlay', { scoreCard: rooms[roomId].scoreCard, message: `You were wrong, these are not matches!`, state: {lobby: false, countDown: false, inGame: false, gameHero: false, gameObserver: false, gameLoser: true, gameCheck: false} });
    socket.broadcast.to(roomId).emit('gamePlay', {scoreCard: rooms[roomId].scoreCard, message: `${data.name} couldn't find a matching pair!`, state: {lobby: false, countDown: false, inGame: true, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false} });
    rooms[roomId].gameState.loserUsers.push(socket.id);
  }
}

const startGame = (roomId) => {
  const { users, settings } = rooms[roomId];
  const cards = generateCardArray(settings, users.length);
  rooms[roomId].gameState.cards = cards.options;
  rooms[roomId].gameState.match = cards.match;
  users.forEach((userId, index) => {
    const userCard = cards.options[index];
    const remainingCards = cards.options.filter((_, i) => i !== index);
    io.to(userId).emit('receiveCards', { userCard, remainingCards });
  });
  io.in(roomId).emit('gamePlay', { message: 'Loading...', state: {lobby: false, countDown: true, inGame: false, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false}});
  setTimeout(() => {
    io.in(roomId).emit('gamePlay', { message: 'Game start!', action:"gameStart", state: {lobby: false, countDown: false, inGame: true, gameHero: false, gameObserver: false, gameLoser: false, gameCheck: false}});
  }, 3000);
  rooms[roomId].gameState.readyUsers = [];
};

const generateCardArray = (settings, userCount) => {
  let cardOptionsArray = [...allCards];
  let categoryUnSet = true;
  let currentCardOptions = [];

  Object.keys(settings).forEach((category) => {
    if (settings[category]) {
      categoryUnSet = false;
      currentCardOptions = currentCardOptions.concat(cardOptionsArray.filter(card => card.category === category));
    } 
  });
  if (categoryUnSet) {
    currentCardOptions = cardOptionsArray;
  }

  const options = [];
  // Determine if we should include a matching pair (30% chance)
  const includeMatchingPair = Math.random() < 0.3;
  // Set the initial length to one less if we plan to add a matching pair
  const initialLength = includeMatchingPair ? userCount - 1 : userCount;

  for (let i = 0; i < initialLength; i++) {
    const randomIndex = Math.floor(Math.random() * currentCardOptions.length);
    const hintType = Math.floor(Math.random() * 3) + 1;
    if (i === 0 && includeMatchingPair) {
      const hintType2 = hintType === 1 ? 3 : hintType === 3 ? 2 : 1;
      const randomExtraCard = {
        category: currentCardOptions[randomIndex].category, 
        value: currentCardOptions[randomIndex].value, 
        hint: currentCardOptions[randomIndex][hintType2]
      };
      options.push(randomExtraCard);
    }
    const randomCard = {
      category: currentCardOptions[randomIndex].category, 
      value: currentCardOptions[randomIndex].value, 
      hint: currentCardOptions[randomIndex][hintType]
    };
    currentCardOptions.splice(randomIndex, 1);
    options.push(randomCard);
  }
  options.shuffle();
  return ({options: options, match: includeMatchingPair});
};

Array.prototype.shuffle = function() {
  for (let i = this.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [this[i], this[j]] = [this[j], this[i]];
  }
  return this;
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

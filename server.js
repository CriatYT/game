const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(express.static(path.join(__dirname, "public")));

// Rota de Teste para o Render saber que o app está vivo
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// Rota de Segurança: Força o envio do jogo em qualquer situação
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function createDeck() {
  const deck = [];
  const roles = ["Agiota", "Matador", "Segurança"];
  roles.forEach((role) => {
    for (let i = 0; i < 5; i++) deck.push(role);
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function broadcastState(room) {
  room.players.forEach((p) => {
    const stateForPlayer = {
      code: room.code,
      centralCoins: room.centralCoins,
      currentPlayerId: room.players[room.currentPlayerIndex].id,
      pendingAction: room.pendingAction,
      players: room.players.map((other) => ({
        id: other.id,
        name: other.name,
        isMe: other.id === p.id,
        isHost: other.id === room.hostId,
        coins: other.coins,
        cards: other.cards.map((c) => ({
          id: c.id,
          role: other.id === p.id || c.isDead ? c.role : "?",
          isDead: c.isDead,
        })),
      })),
    };
    io.to(p.id).emit("update_state", stateForPlayer);
  });
}

function getWaitingRoomState(code) {
  const room = rooms[code];
  return {
    code,
    hostId: room.hostId,
    players: room.players.map((p) => ({ name: p.name, isHost: p.isHost })),
  };
}

function killCard(player) {
  const aliveCard = player.cards.find((c) => !c.isDead);
  if (aliveCard) aliveCard.isDead = true;
}

function killNextAlivePlayer(room, actorId) {
  const actorIndex = room.players.findIndex((p) => p.id === actorId);
  for (let i = 1; i < room.players.length; i++) {
    let targetIndex = (actorIndex + i) % room.players.length;
    let target = room.players[targetIndex];
    if (target.cards.some((c) => !c.isDead)) {
      killCard(target);
      break;
    }
  }
}

function executeAction(room, action, player) {
  if (action === "pequeno_furto") {
    if (room.centralCoins >= 1) {
      room.centralCoins -= 1;
      player.coins += 1;
    }
  } else if (action === "extorsao") {
    let take = Math.min(3, room.centralCoins);
    room.centralCoins -= take;
    player.coins += take;
  } else if (action === "contrato") {
    player.coins -= 3;
    room.centralCoins += 3;
    killNextAlivePlayer(room, player.id);
  } else if (action === "execucao") {
    player.coins -= 7;
    room.centralCoins += 7;
    killNextAlivePlayer(room, player.id);
  }
}

function passTurn(room) {
  if (room.status === "game_over") return;
  let nextIndex = (room.currentPlayerIndex + 1) % room.players.length;
  let limit = 0;
  while (limit < room.players.length) {
    const p = room.players[nextIndex];
    if (p.cards.some((c) => !c.isDead)) break;
    nextIndex = (nextIndex + 1) % room.players.length;
    limit++;
  }
  room.currentPlayerIndex = nextIndex;
  broadcastState(room);
}

function checkWinCondition(room) {
  const alivePlayers = room.players.filter((p) =>
    p.cards.some((c) => !c.isDead),
  );
  if (alivePlayers.length <= 1 && room.status !== "game_over") {
    room.status = "game_over";
    if (room.actionTimer) clearInterval(room.actionTimer);
    io.to(room.code).emit(
      "game_over",
      alivePlayers.length === 1 ? alivePlayers[0].name : "Ninguém",
    );
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }) => {
    const code = generateRoomCode();
    console.log("Sala criada:", code);
    rooms[code] = {
      code,
      hostId: socket.id,
      status: "waiting",
      deck: [],
      centralCoins: 15,
      players: [{ id: socket.id, name, isHost: true, coins: 0, cards: [] }],
      currentPlayerIndex: 0,
      pendingAction: null,
      actionTimer: null,
    };
    socket.join(code);
    socket.roomId = code;
    io.to(code).emit("room_joined", getWaitingRoomState(code));
  });

  socket.on("join_room", ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit("error", "Sala não encontrada!");
    if (room.status !== "waiting")
      return socket.emit("error", "O jogo já começou!");
    if (room.players.length >= 6) return socket.emit("error", "Sala cheia!");

    room.players.push({
      id: socket.id,
      name,
      isHost: false,
      coins: 0,
      cards: [],
    });
    socket.join(code);
    socket.roomId = code;
    io.to(code).emit("room_joined", getWaitingRoomState(code));
  });

  socket.on("start_game", () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 3)
      return socket.emit("error", "Mínimo de 3 jogadores.");

    room.status = "playing";
    room.deck = createDeck();
    room.centralCoins = 15;

    let initialDeckId = 1;
    room.players.forEach((p) => {
      p.coins = 2;
      p.cards = [
        { id: "c" + initialDeckId++, role: room.deck.pop(), isDead: false },
        { id: "c" + initialDeckId++, role: room.deck.pop(), isDead: false },
      ];
    });

    io.to(room.code).emit("game_started");
    broadcastState(room);
  });

  socket.on("player_action", ({ action }) => {
    const room = rooms[socket.roomId];
    if (!room || room.status !== "playing") return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id || room.pendingAction) return;

    if (action === "contrato" && currentPlayer.coins < 3)
      return socket.emit("error", "Você não tem 3 moedas para o Contrato!");
    if (action === "execucao" && currentPlayer.coins < 7)
      return socket.emit("error", "Você não tem 7 moedas para a Execução!");

    const isRoleAction = ["extorsao", "contrato"].includes(action);
    if (isRoleAction) {
      room.pendingAction = { playerId: socket.id, action: action, timeLeft: 7 };
      broadcastState(room);
      room.actionTimer = setInterval(() => {
        room.pendingAction.timeLeft--;
        if (room.pendingAction.timeLeft <= 0) {
          clearInterval(room.actionTimer);
          room.pendingAction = null;
          executeAction(room, action, currentPlayer);
          checkWinCondition(room);
          passTurn(room);
        } else {
          broadcastState(room);
        }
      }, 1000);
    } else {
      executeAction(room, action, currentPlayer);
      checkWinCondition(room);
      passTurn(room);
    }
  });

  socket.on("challenge_action", () => {
    const room = rooms[socket.roomId];
    if (
      !room ||
      !room.pendingAction ||
      room.pendingAction.playerId === socket.id
    )
      return;

    clearInterval(room.actionTimer);
    const actor = room.players.find(
      (p) => p.id === room.pendingAction.playerId,
    );
    const challenger = room.players.find((p) => p.id === socket.id);
    const action = room.pendingAction.action;
    room.pendingAction = null;

    let requiredRole =
      action === "extorsao" ? "Agiota" : action === "contrato" ? "Matador" : "";
    const validCardIndex = actor.cards.findIndex(
      (c) => !c.isDead && c.role === requiredRole,
    );

    if (validCardIndex === -1) {
      killCard(actor);
    } else {
      killCard(challenger);
      const card = actor.cards[validCardIndex];
      room.deck.push(card.role);
      for (let i = room.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
      }
      card.role = room.deck.pop();
      executeAction(room, action, actor);
    }
    checkWinCondition(room);
    passTurn(room);
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const pIndex = room.players.findIndex((p) => p.id === socket.id);
      if (pIndex !== -1) {
        room.players.splice(pIndex, 1);
        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            room.players[0].isHost = true;
          }
          if (room.status === "waiting") {
            io.to(code).emit("room_joined", getWaitingRoomState(code));
          } else if (room.status === "playing") {
            if (room.currentPlayerIndex >= room.players.length) {
              room.currentPlayerIndex = 0;
            }
            if (
              room.pendingAction &&
              room.pendingAction.playerId === socket.id
            ) {
              if (room.actionTimer) clearInterval(room.actionTimer);
              room.pendingAction = null;
              passTurn(room);
            } else {
              broadcastState(room);
              checkWinCondition(room);
            }
          }
        }
        break;
      }
    }
  });

  socket.on("voltar_lobby", () => {
    const room = rooms[socket.roomId];
    if (room && room.hostId === socket.id) {
      room.status = "waiting";
      io.to(room.code).emit("room_joined", getWaitingRoomState(room.code));
    }
  });
});

const PORT = parseInt(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[SUCESSO] Servidor inicializado e escutando na porta ${PORT}`);
});

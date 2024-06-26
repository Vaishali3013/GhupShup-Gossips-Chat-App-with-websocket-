import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";

// DB imports
import connectDB from "./db/connection.js";
import Users from "./models/Users.js";
import Conversations from "./models/conversations.js";
import Messages from "./models/messages.js";
import { formatIST, getFormattedDateTime } from "./helpers.js";

const PORT = process.env.PORT || 8088;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
app.use(cors());

// Middlewares
app.use(express.json());

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || "JWT_TOKEN_SECRET_KEY";

app.get("/", (_, res) => {
  res.send("Ghupshup & Gossips is working fine");
});

app.post("/api/register", async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).send("Enter valid data.");
    } else {
      const isEmailExists = await Users.findOne({ email });
      if (isEmailExists) {
        res.status(400).send("User elready exists.");
      } else {
        const newUser = new Users({ fullName, email });
        bcryptjs.hash(password, 10, (err, hashedPW) => {
          newUser.set("password", hashedPW);
          newUser.save();
          next();
        });
        return res.status(200).send("User created.");
      }
    }
  } catch (error) {
    res.status(400).send("Error");
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).send("Please fill all required fields.");
    } else {
      const user = await Users.findOne({ email });
      if (!user) {
        res.status(400).send("User doesn't exist.");
      } else {
        const validateUser = await bcryptjs.compare(password, user.password);
        if (!validateUser) {
          res.status(400).send("Password is incorrect.");
        } else {
          const payload = {
            userId: user._id,
            email: user.email,
          };
          jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: 84600 }, async (err, token) => {
            if (err) {
              console.error("Error signing token:", err);
              res.status(500).send("Error signing token.");
            } else {
              user.token = token;
              await user.save();
              res.status(200).json({ user, token });
            }
          });
        }
      }
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).send("Something wrong.");
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const users = await Users.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).send("Something Wrong");
  }
});

app.post("/api/conversation", async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    let alreadyPresentConv = await Conversations.findOne({ members: { $all: [senderId, receiverId] } });

    let conv;
    if (alreadyPresentConv) {
      conv = alreadyPresentConv;
    } else {
      const newConversation = new Conversations({ members: [senderId, receiverId] });
      await newConversation.save();
      let resConversation = await Conversations.findOne({ members: { $all: [senderId, receiverId] } });
      conv = resConversation;
    }

    let receiverUser = await Users.findById(receiverId);
    let formattedResponseData = {
      user: {
        name: receiverUser.fullName,
        email: receiverUser.email,
        id: receiverUser._id,
        profilePhoto: receiverUser.profilePhoto,
      },
      conversationId: conv._id,
    };
    res.status(200).json(formattedResponseData);
  } catch (error) {
    console.log(error);
    res.status(500).send("Something wrong.");
  }
});

app.get("/api/conversation/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const conversationList = await Conversations.find({ members: { $in: [userId] } });
    const finalRes = await Promise.all(
      conversationList.map(async (conv) => {
        let receiverId = conv.members.find((el) => el !== userId);
        let receiverUser = await Users.findById(receiverId);
        return {
          user: {
            name: receiverUser?.fullName,
            email: receiverUser?.email,
            id: receiverUser?._id,
            profilePhoto: receiverUser?.profilePhoto,
          },
          conversationId: conv?._id,
          lastMessage: conv?.lastMessage,
        };
      })
    );
    res.status(200).json(finalRes);
  } catch (error) {
    res.status(500).send("Something Wrong");
  }
});

app.get("/api/getUserFromToken/:token", async (req, res) => {
  try {
    const token = req.params.token;
    try {
      const isValidToken = jwt.verify(token, JWT_SECRET_KEY);
      if (isValidToken) {
        let userDetails = await Users.findOne({ email: isValidToken.email });
        return res.status(200).json(userDetails);
      } else {
        return res.status(400).send("Token expired, Please Login again");
      }
    } catch (error) {
      res.status(400).send("Token expired, Please Login again");
    }
  } catch (error) {
    console.log(error);
    res.status(400).send("Something Wrong:");
  }
});

app.post("/api/logoutUser/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    let userDetails = await Users.findOne({ _id: userId });
    await Users.updateOne(
      { _id: userDetails._id },
      {
        $set: { token: null },
      }
    );
    userDetails.save();
    res.status(200).send("Logout Successfully");
  } catch (error) {
    console.log(error);
    res.status(400).send("Something Wrong:");
  }
});

app.post("/api/message", async (req, res) => {
  try {
    const { senderId, receiverId, conversationId, message } = req.body;
    if (!message || !senderId || !receiverId || !conversationId) {
      res.status(400).send("Please fill all the details.");
    } else {
      let newMessage = new Messages({ senderId, receiverId, message, conversationId, dateTime: formatIST() });
      let conversation = await Conversations.findOne({ members: { $all: [senderId, receiverId] } });
      await Conversations.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessage: {
              message,
              senderId,
              dateTime: getFormattedDateTime(),
            },
          },
        }
      );
      await newMessage.save();
      res.status(200).json({
        newMessage: { ...newMessage.toObject(), dateTime: getFormattedDateTime() },
      });
    }
  } catch (error) {
    console.log(error);
    res.status(500).send("Something wrong.");
  }
});

app.get("/api/message/:conversationId", async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    const messagesList = await Messages.find({ conversationId });
    let listWithISTDateTime = messagesList
      .map((el) => el.toObject())
      .map((item) => ({
        ...item,
        dateTime: getFormattedDateTime(item.dateTime),
      }));
    res.status(200).json(listWithISTDateTime);
  } catch (error) {
    console.log(error);
    res.status(500).send("Something wrong.");
  }
});

app.post("/api/googleAuth/login", async (req, res) => {
  try {
    const { name, email, profilePhoto } = req.body;
    const isEmailExists = await Users.findOne({ email });

    if (!isEmailExists) {
      const newUser = new Users({ fullName: name, email, isGoogleAuth: true, profilePhoto });
      await newUser.save();
    }
    const user = await Users.findOne({ email });
    const payload = {
      userId: user._id,
      email: user.email,
    };
    jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: 84600 }, async (err, token) => {
      if (err) {
        console.error("Error signing token:", err);
        res.status(500).send("Error signing token.");
      } else {
        user.token = token;
        await user.save();
        res.status(200).json({ user: user, token });
      }
    });
  } catch (error) {
    res.status(400).send("Error");
  }
});

//Sockets

let onlineUsers = [];

io.on("connection", (socket) => {
  console.log(socket.id);

  socket.on("addUser", (userId) => {
    let isUserPresent = onlineUsers.find((el) => el.userId === userId);
    if (!isUserPresent) {
      onlineUsers.push({ userId, socketId: socket.id });
      io.emit("getOnlineUsers", onlineUsers);
    }
  });

  socket.on("sendMsg", async (newMessage) => {
    try {
      let findOnlineUserReceiver = onlineUsers.find((user) => user.userId === newMessage.receiverId);
      let findOnlineUserSender = onlineUsers.find((user) => user.userId === newMessage.senderId);
      let receiverUser = await Users.findById(newMessage.receiverId);
      let senderUser = await Users.findById(newMessage.senderId);

      if (findOnlineUserReceiver) {
        io.to(findOnlineUserReceiver.socketId).emit("getNewMessages", {
          ...newMessage,
          dateTime: getFormattedDateTime(),
        });
        io.to(findOnlineUserReceiver.socketId).emit("getNewMessageInConversation", {
          user: {
            name: receiverUser.fullName,
            email: receiverUser.email,
            id: receiverUser._id,
            profilePhoto: receiverUser?.profilePhoto,
          },
          conversationId: newMessage.conversationId,
          lastMessage: {
            message: newMessage.message,
            senderId: newMessage.senderId,
            dateTime: getFormattedDateTime(),
          },
        });
      }

      if (findOnlineUserSender) {
        io.to(findOnlineUserSender.socketId).emit("getNewMessageInConversation", {
          user: {
            name: senderUser.fullName,
            email: senderUser.email,
            id: senderUser._id,
            profilePhoto: senderUser?.profilePhoto,
          },
          conversationId: newMessage.conversationId,
          lastMessage: {
            message: newMessage.message,
            senderId: newMessage.senderId,
            dateTime: getFormattedDateTime(),
          },
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  });

  socket.on("sendConversation", async (newConv) => {
    let findOnlineUser = onlineUsers.find((el) => el.userId === newConv.user.id);
    if (findOnlineUser) {
      let user = await Users.findById(newConv?.userId);
      let resData = {
        user: {
          name: user.fullName,
          email: user.email,
          id: user._id,
          profilePhoto: user.profilePhoto,
        },
        conversationId: newConv?.conversationId,
      };
      io.to(findOnlineUser.socketId).emit("getNewConversation", resData);
    }
  });

  socket.on("disconnect", () => {
    onlineUsers = onlineUsers.filter((el) => el.socketId !== socket.id);
    io.emit("getOnlineUsers", onlineUsers);
  });
});

//DB CONNECT
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log("server running at http://localhost:8088");
  });
});

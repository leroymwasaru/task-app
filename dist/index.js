"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const twilio_1 = require("twilio");
const dotenv_1 = __importDefault(require("dotenv"));
const node_cron_1 = __importDefault(require("node-cron"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const mongodb_1 = require("mongodb");
const lodash_1 = __importDefault(require("lodash"));
dotenv_1.default.config();
let db;
let usersCollection;
let tasksCollection;
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
mongodb_1.MongoClient.connect(uri)
    .then((client) => {
    db = client.db(process.env.DB_NAME);
    usersCollection = db.collection("users");
    tasksCollection = db.collection("tasks");
})
    .catch((err) => {
    console.error(err);
});
const app = (0, express_1.default)();
app.use(body_parser_1.default.urlencoded({ extended: true }));
const twilioClient = new twilio_1.Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
let tasks = {};
function addTask(date, description) {
    if (!tasks[date]) {
        tasks[date] = [];
    }
    tasks[date].push({ description, completed: false });
}
function completeTask(date, descriptionStart) {
    var _a;
    const task = (_a = tasks[date]) === null || _a === void 0 ? void 0 : _a.find((task) => task.description.startsWith(descriptionStart));
    if (task) {
        task.completed = true;
    }
    return task;
}
function listTasks(date) {
    return __awaiter(this, void 0, void 0, function* () {
        const tasks = yield tasksCollection.find({ date }).toArray();
        return (tasks
            .map((task) => `${task.completed ? "✅" : "⬜️"} - ${task.description}`)
            .join("\n") || "no tasks for today, huh?");
    });
}
function sendTaskList() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = (0, moment_timezone_1.default)().tz("Africa/Nairobi").format("YYYY-MM-DD");
        const taskList = yield listTasks(today);
        try {
            const users = yield usersCollection.find().toArray();
            for (const user of users) {
                try {
                    yield twilioClient.messages.create({
                        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
                        to: user.number,
                        body: taskList
                    });
                }
                catch (err) {
                    console.error(err);
                }
            }
        }
        catch (err) {
            console.error(err);
        }
    });
}
function getTaskHistory() {
    return __awaiter(this, void 0, void 0, function* () {
        const thirtyDaysAgo = (0, moment_timezone_1.default)().subtract(30, "days").format("YYYY-MM-DD");
        const tasks = yield tasksCollection
            .find({ date: { $gte: thirtyDaysAgo } })
            .toArray();
        const groupedTasks = lodash_1.default.groupBy(tasks, "date");
        let history = "";
        for (const [date, tasks] of Object.entries(groupedTasks)) {
            const allCompleted = tasks.every((task) => task.completed);
            history += `${date}: ${allCompleted ? "✅" : "⬜️"}\n`;
        }
        return history || "No tasks in the last 30 days.";
    });
}
// schedule the cron job — every day at 10am and 10pm
node_cron_1.default.schedule("0 10 * * *", sendTaskList, {
    timezone: "Africa/Nairobi"
});
node_cron_1.default.schedule("0 22 * * *", sendTaskList, {
    timezone: "Africa/Nairobi"
});
app.post("/whatsapp", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const incomingMsg = req.body.Body.trim();
    const fromNumber = req.body.From;
    //grab the user's number and save it to the database
    usersCollection.updateOne({ number: fromNumber }, { $set: { number: fromNumber } }, { upsert: true });
    const today = new Date().toISOString().slice(0, 10);
    if (incomingMsg.startsWith("add ")) {
        const taskDescription = incomingMsg.slice(4);
        addTask(today, taskDescription);
        twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: fromNumber,
            body: "task added!"
        });
    }
    else if (incomingMsg.startsWith("complete ")) {
        const taskDescription = incomingMsg.slice(9);
        const completedTask = completeTask(today, taskDescription);
        if (completedTask) {
            twilioClient.messages.create({
                from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
                to: fromNumber,
                body: `task '${completedTask.description}' marked as complete.`
            });
        }
        else {
            twilioClient.messages.create({
                from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
                to: fromNumber,
                body: "lol, task not found."
            });
        }
    }
    else if (incomingMsg === "list") {
        const taskList = yield listTasks(today);
        twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: fromNumber,
            body: taskList
        });
    }
    else if (incomingMsg === "history") {
        const taskHistory = yield getTaskHistory();
        twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: fromNumber,
            body: taskHistory
        });
    }
    res.status(200).end();
}));
const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

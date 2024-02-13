import express from "express"
import bodyParser from "body-parser"
import { Twilio } from "twilio"
import dotenv from "dotenv"
import cron from "node-cron"
import moment from "moment-timezone"
import { MongoClient, Collection } from "mongodb"
import _ from "lodash"
import fuzzball from "fuzzball"

dotenv.config()

let usersCollection: Collection
let tasksCollection: Collection

const uri = process.env.MONGODB_URI
const PORT = process.env.PORT

if (!uri) {
  throw new Error("The MONGODB_URI environment variable is not set.")
}

MongoClient.connect(uri)
  .then((client) => {
    const db = client.db(process.env.DB_NAME)
    usersCollection = db.collection("users")
    tasksCollection = db.collection("tasks")
    // Start the server after the database connection is established
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error(err)
  })

const app = express()
app.use(bodyParser.urlencoded({ extended: true }))

const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

interface Task {
  description: string
  completed: boolean
}

async function checkIfEmptyString(taskDescription: string, fromNumber: string) {
  if (taskDescription.trim() === "") {
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
      body: `🫠 empty task lol`
    })
    return false
  }
  return true
}

async function addTask(description: string, userNumber: string) {
  try {
    const currentDate = new Date().toISOString() // get current date and time in ISO format
    await tasksCollection.insertOne({
      date: currentDate,
      description,
      completed: false,
      userNumber
    })
  } catch (err) {
    console.error(err)
  }
}

async function completeTask(
  descriptionStart: string,
  userNumber: string
): Promise<Task | undefined> {
  try {
    const task = await tasksCollection.findOne({
      description: { $regex: `^${descriptionStart.trim()}`, $options: "i" },
      userNumber,
      completed: false //reduce likelihood of regex matching completed tasks
    })
    if (task) {
      if (!task.completed) {
        // If the task is not already completed
        task.completed = true
        const currentDate = new Date().toISOString() // get current date and time in ISO format
        await tasksCollection.updateOne(
          { _id: task._id },
          { $set: { completed: true, completed_date: currentDate } } // update completed and completed_date fields
        )
      }
      return task as unknown as Task
    }
    return undefined
  } catch (err) {
    console.error(err)
  }
}

async function listTasks(userNumber: string): Promise<string> {
  const currentDate = moment().utcOffset(180) // get current date and time in Kenyan time
  const startOfDay = currentDate.clone().startOf("day").toISOString()
  const endOfDay = currentDate.clone().endOf("day").toISOString()

  const tasks = await tasksCollection
    .find({
      userNumber,
      $or: [
        { date: { $gte: startOfDay, $lte: endOfDay }, completed: false }, // incomplete tasks from today
        { date: { $lt: startOfDay }, completed: false }, // incomplete tasks from previous days
        {
          completed: true,
          completed_date: { $gte: startOfDay, $lte: endOfDay }
        } // tasks completed today
      ]
    })
    .toArray()

  return (
    tasks
      .map((task) => `${task.completed ? "✅" : "⬜️"} - ${task.description}`)
      .join("\n") || "no tasks for today, huh?"
  )
}

async function sendTaskList() {
  const today = moment().tz("Africa/Nairobi").toISOString() // get current date and time in ISO format

  try {
    const users = await usersCollection.find().toArray()

    for (const user of users) {
      const taskList = await listTasks(user.number)
      try {
        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: user.number,
          body: `uhm, today's list:\n\n${taskList}`
        })
      } catch (err) {
        console.error(err)
      }
    }
  } catch (err) {
    console.error(err)
  }
}

async function getTaskHistory(userNumber: string): Promise<string> {
  let thirtyDaysAgo = moment().tz("Africa/Nairobi").subtract(30, "days") // in Kenyan time

  const tasks = await tasksCollection
    .find({
      date: {
        $gte: moment(thirtyDaysAgo)
          .tz("Africa/Nairobi")
          .startOf("day")
          .toISOString()
      },
      userNumber
    }) // compare full date-time string
    .toArray()

  const groupedTasks = _.groupBy(
    tasks,
    (task) => moment(task.date).tz("Africa/Nairobi").format("YYYY-MM-DD") // group by date part only
  )

  let history = ""
  for (let i = 0; i < 30; i++) {
    thirtyDaysAgo = moment(thirtyDaysAgo).add(1, "days") // increment the date by one day in Kenyan time

    const date = thirtyDaysAgo.clone().format("YYYY-MM-DD") // adjust for Kenyan time

    const tasksForDate = groupedTasks[date] || []

    const allCompleted =
      tasksForDate.length > 0 &&
      tasksForDate.every((task: any) => {
        const taskDate = moment(task.date)
          .tz("Africa/Nairobi")
          .format("YYYY-MM-DD")
        const completedDate = moment(task.completed_date)
          .tz("Africa/Nairobi")
          .format("YYYY-MM-DD")
        return task.completed && taskDate === completedDate
      })

    const isToday = moment().tz("Africa/Nairobi").format("YYYY-MM-DD") === date // compare to current date in Kenyan time

    history = `${isToday ? (allCompleted ? "✅" : "🟨") : allCompleted ? "✅" : "⬜️"} ${history}`
  }
  return history || "no tasks in the last 30 days, lazy much?"
}

async function removeTask(
  descriptionStart: string,
  userNumber: string
): Promise<any> {
  try {
    const task = await tasksCollection.findOne({
      description: { $regex: `^${descriptionStart}` },
      userNumber,
      completed: false
    })
    if (task) {
      await tasksCollection.deleteOne({ _id: task._id })
    }
    return task
  } catch (err) {
    console.error(err)
  }
}

// schedule the cron job — every day at 12pm and 10pm
cron.schedule("0 12 * * *", sendTaskList, {
  timezone: "Africa/Nairobi"
})

cron.schedule("0 22 * * *", sendTaskList, {
  timezone: "Africa/Nairobi"
})

app.post("/whatsapp", async (req, res) => {
  const incomingMsg = req.body.Body.trim().toLowerCase()
  const fromNumber = req.body.From
  const commands = ["add", "complete", "list", "history", "remove"]
  const firstWord = incomingMsg.split(" ")[0]
  const matches = fuzzball.extract(firstWord, commands)
  const closestCommand = matches[0][0]
  const MATCH_THRESHOLD = 60

  //grab the user's number and check if they have received the help message
  let user
  try {
    user = await usersCollection.findOne({ number: fromNumber })
    if (!user) {
      await usersCollection.insertOne({
        number: fromNumber,
        help_message: false
        //possible interesting use of help_message_date (string) type here :) e.g resend help message after 7 days. etc
      })
      user = { number: fromNumber, help_message: false }
    }
  } catch (err) {
    console.error(err)
  }

  if (matches.length === 0 || matches[0][1] < MATCH_THRESHOLD) {
    const score = matches.length > 0 ? matches[0][1] : 0
    let helpMessage = ""

    if (user && user.help_message) {
      helpMessage = `😕 that command was a *${score}%* match. i need a >*${MATCH_THRESHOLD}%* match to understand the command.`
    }

    if (user && !user.help_message) {
      helpMessage =
        `
        hiya! here are the commands you can use:

1. ➕ "Add buy milk" — this adds "buy milk" to your tasks.

2. ✅ "Complete buy milk" — marks "buy milk" as complete.

3. 📋 "List" — shows all tasks that are not yet completed.

4. 📆 "History" — shows a heatmap of your tasks over the last 30 days.

5. 🙉 "Remove buy milk" — removes "buy milk" from your tasks.
        
` + helpMessage

      await usersCollection.updateOne(
        { number: fromNumber },
        { $set: { help_message: true, help_message_date: new Date() } }
      )
    }

    twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
      body: helpMessage
    })
    res.status(200).end()
    return
  }

  // if the command is recognized, update the user's number in the database
  try {
    await usersCollection.updateOne(
      { number: fromNumber },
      { $set: { number: fromNumber } },
      { upsert: true }
    )
  } catch (err) {
    console.error(err)
  }

  if (closestCommand === "add") {
    const taskDescription = incomingMsg.slice(firstWord.length + 1)
    if (!(await checkIfEmptyString(taskDescription, fromNumber))) {
      res.status(200).end()
      return
    }
    await addTask(taskDescription, fromNumber)
    const taskList = await listTasks(fromNumber)
    twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
      body: `*${taskDescription}* added! updated task list:\n\n${taskList}`
    })
  } else if (closestCommand === "complete") {
    const taskDescription = incomingMsg.slice(firstWord.length + 1)
    if (!(await checkIfEmptyString(taskDescription, fromNumber))) {
      res.status(200).end()
      return
    }
    const completedTask = await completeTask(taskDescription, fromNumber)
    if (completedTask) {
      const taskList = await listTasks(fromNumber)
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
        body: `yep! *${completedTask.description}* marked complete 🎉 ...today's to-do:\n\n${taskList}`
      })
    } else {
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
        body: "lol, that task doesn't exist... or it's already completed :P"
      })
    }
  } else if (closestCommand === "list") {
    const taskList = await listTasks(fromNumber)
    twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
      body: taskList
    })
  } else if (closestCommand === "history") {
    const taskHistory = await getTaskHistory(fromNumber)
    twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
      body: `30-day heatmap 💪🏼 - ${taskHistory}`
    })
  } else if (closestCommand === "remove") {
    const taskDescription = incomingMsg.slice(firstWord.length + 1)
    if (!(await checkIfEmptyString(taskDescription, fromNumber))) {
      res.status(200).end()
      return
    }
    const removedTask = await removeTask(taskDescription, fromNumber)
    if (!removedTask) {
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
        body: "...found nothing to remove 🤔"
      })
    } else {
      const taskList = await listTasks(fromNumber)
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
        body: `👀 *${removedTask.description}* removed... updated task list:\n\n${taskList}`
      })
    }
  }

  res.status(200).end()
})

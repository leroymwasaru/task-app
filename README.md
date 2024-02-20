# Task App

Task management application that uses WhatsApp endpoints. Allows you to add, complete, list, and remove tasks + provides a history of your tasks over the last 30 days.

## Pre-requisites

- Node.js
- MongoDB
- A Twilio account

## Installation

1. Clone the repository: `git clone https://github.com/leroymwasaru/task_app.git`
2. Navigate to the project directory: `cd task_app`
3. Install the dependencies: `npm install`

## Usage

1. Start the server: `npm start`
2. The server will start on `http://localhost:${PORT}`

## Interacting with the App

You can interact with the app using the following commands:

- `add <task>`: Adds a new task.
- `complete <task>`: Marks a task as complete.
- `list`: Lists all tasks.
- `history`: Shows a heatmap of your tasks over the last 30 days.
- `remove <task>`: Removes a task.

## Cron Jobs

The application has two cron jobs that run at 12pm and 10pm every day. These jobs send the task list to all users.

## Endpoints

- POST `/whatsapp`: This endpoint receives WhatsApp messages, processes the commands, and sends the appropriate response.

---

> [!TIP]
> Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## Environment Variables

The application uses the following environment variables:

- `MONGODB_URI`: The connection string for your MongoDB database.
- `DB_NAME`: The name of your MongoDB database.
- `PORT`: The port on which your server will run.
- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID.
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token.
- `TWILIO_WHATSAPP_NUMBER`: Your Twilio WhatsApp number.

Read more in [this blog-post](https://leroymwasaru.com/taskapp)

## License

[MIT](https://choosealicense.com/licenses/mit/)

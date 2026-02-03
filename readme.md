# AOKillboard-DiscordBot

A Discord bot for Albion Online's kill board.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

![image](https://media.discordapp.net/attachments/1467674188381819114/1468370646634598450/kill.png?ex=6983c63b&is=698274bb&hm=89e3777f94a197f09641f5a8b00dbfd75a7c74976613934062b0127f19eb2364&=&format=webp&quality=lossless&width=790&height=768)





### Usage

* `/profile` - shows kill/death stats of a player from posted kills
* `/summary` - shows summary of posted kills


### Prerequisites

* [NodeJS](https://nodejs.org/)
* [Docker](https://www.docker.com/)
* [AWS CLI](https://aws.amazon.com/cli/) (for running on EC2)
* [SSH Client](https://www.ssh.com/ssh/putty/windows/) (for connecting to EC2)

### Installing

#### 1. Local Setup

1. **Clone the repository:**
   ```sh
   git clone https://github.com/pierrefeza/AOKillBoard-DiscordBot.git
   cd AOKillBoard-DiscordBot

2. **Install Node.js dependencies:**
    ```sh
    npm install

3. **Create a new Discord Application:**
    * Visit [the Discord Developer Portal](https://discordapp.com/developers/applications/) 
    * Create a new application and add a bot to it.
    * Copy the 'BOT' token

4. **Set up your `config.json`:**
    * Copy `config.json.example` to `config.json`
    * Update `config.json` with your bot token, botChannel, and other necessary details.

    Example `config.json`:
    ```{
    "cmdPrefix": "!",
    "allianceName": "<NONE>",
    "guildName": "8-bit",
    "username": "AOKillBoard-DiscordBot",
    "admins": [
        "ADMIN_ID"
    ],
    "botChannel": "445822300890946337",
    "playingGame": "Albion Killboard Bot",
    "token": "YOUR_DISCORD_BOT_TOKEN"
    }```

### 2. Running with Docker Locally

1. **Build the Docker image:**
    ```sh
    docker build -t aokillboard-discordbot .

2. **Run the Docker container:**
    ```sh
    docker run -d --name aokillboard-discordbot aokillboard-discordbot 

3. **Check the logs:**
    ```sh
    docker logs -f aokillboard-discordbot

4. **Summary commands**
    ```sh
    docker stop aokillboard-discordbot
    docker rm aokillboard-discordbot
    docker build -t aokillboard-discordbot .
    docker run -d --name aokillboard-discordbot aokillboard-discordbot
    docker logs -f aokillboard-discordbot

### Built With

* [Discord.js](https://github.com/hydrabolt/discord.js/) - Discord app library for Node.js and browsers.
* [Axios](https://axios-http.com/docs/intro) - Promise-based HTTP Client for node.js

## Credits

* Current working state by [Pierre Donal Feza](https://github.com/pierrefeza) Discord: **yokokosparda**
* [UI Layout inspiration](https://albion-killbot.com) - albion-killbot
* [Initial Implementation](https://github.com/bearlikelion/ao-killbot/) from **Mark Arneman**






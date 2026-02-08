# Discord to Immich Asset Uploader

A Node.js tool that extracts media attachments from Discord data packages and uploads them to an [Immich](https://immich.app/) server with backdated timestamps.

## Environment Variables

1. Clone the repository:
```bash
git clone https://github.com/uwx/steammich.git
cd steammich
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
# Create a .env file in the project root
DISCORD_DATA_PACKAGE_DIR=/path/to/discord/data/package
# It must be extracted!
```

4. Login with the Immich CLI (`pnpm dlx @immich/cli login <url> <key>`)

## Usage

### Basic Usage

Run the tool to upload all Discord screenshots:

```bash
pnpm dlx tsx src/index.ts
```

## License


AGPL

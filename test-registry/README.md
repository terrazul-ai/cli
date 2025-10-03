# Test Registry

A fake registry server for testing the complete Terrazul CLI workflow: extract → publish → install.

## Features

- **Package Storage**: Stores published packages in `storage/` directory
- **Persistent Registry**: Maintains package metadata in `packages.json`
- **Full API Support**: Implements all registry endpoints needed by `tz` CLI
- **Multipart Uploads**: Handles package publishing with tarball + metadata
- **Content Integrity**: Generates SHA256 checksums for packages

## Usage

### Start the Registry

```bash
npm run test-registry
```

The server will start on `http://localhost:8787` and create:

- `test-registry/storage/` - Tarball storage
- `test-registry/packages.json` - Package metadata registry

### Test Full Workflow

```bash
# Run the complete extract → publish → install workflow
npm run test-workflow
```

This will:

1. Clean up previous test runs
2. Extract Claude configs into a package
3. Publish the package to the fake registry
4. Install the package in a fresh project

### Manual Testing

```bash
# Start the registry (in terminal 1)
npm run test-registry

# In another terminal, test individual commands
npm run tz -- extract --from .claude --out my-package --name "@test/my-config" --pkg-version "1.0.0"

cd my-package
npm run tz -- publish

cd ..
mkdir test-project && cd test-project
npm run tz -- init
npm run tz -- install "@test/my-config@1.0.0"
```

## API Endpoints

- `GET /packages/v1/{package}/versions` - Get package versions
- `GET /packages/v1/{package}/tarball/{version}` - Get tarball download info
- `GET /tarballs/{package}-{version}.tgz` - Download actual tarball
- `POST /packages/v1/{package}/publish` - Publish new package version

## Storage Format

```
test-registry/
├── server.js           # Registry server
├── packages.json       # Package metadata
└── storage/
    ├── @test_my-config-1.0.0.tgz
    └── @user_other-package-2.1.0.tgz
```

The fake registry persists data between restarts, so you can test package management workflows realistically.

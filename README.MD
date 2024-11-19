# Gitlab Downloader

`Gitlab Downloader` is a tool for automatically fetching and cloning all repositories from a specified GitLab group, including repositories in subgroups.
Repositories are organized into a hierarchical folder structure matching the subgroup structure in GitLab.

## Features
- Support for recursively fetching repositories from groups and subgroups.
- Clone repositories via HTTPS using a personal GitLab access token.
- Asynchronous cloning for faster processing.
- Create a local folder structure matching the GitLab subgroup hierarchy.

## Installation

### Local Installation

1. Ensure Python 3.10 or higher is installed.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Using Docker

1. Build the Docker image:
   ```bash
   docker build -t fetch-repositories .
   ```

2. Run the container:
   ```bash
   make docker_run
   ```

## Usage

### Local Execution

1. Create a `.env` file in the project root with the following variables:
   ```env
   GITLAB_URL=https://gitlab.com
   GITLAB_TOKEN=your_personal_access_token
   GITLAB_GROUP=group_name
   CLONE_PATH=./repositories
   ```

2. Run the script:
   ```bash
   python fetch_repositories.py
   ```

### Using Docker

1. Ensure the `.env` file is available.
2. Use the Makefile to build and run the container:
   ```bash
   make docker_run
   ```

## How to Obtain a GitLab Token

1. Log in to your GitLab account.
2. Go to user settings (**Settings**).
3. Select **Access Tokens** or use [this link](https://gitlab.com/-/profile/personal_access_tokens).
4. Specify the token name, expiration date (optional), and enable the following permissions:
   - `read_api` — to read through the API.
   - `read_repository` — to access repositories.
5. Click **Create personal access token** and save the token.

## Files

- `fetch_repositories.py`: The main script for fetching and cloning repositories.
- `Dockerfile`: File for building the Docker image.
- `Makefile`: Automates the build and run process for the container.
- `requirements.txt`: List of dependencies.

## Requirements

- Python 3.10+
- Docker (for containerized execution)
- Personal GitLab access token with appropriate API permissions.

## Usage Scenarios

### Cloning Repositories from a Group

1. Specify environment variables in `.env` or pass them through the command line.
2. Run the script to clone all repositories, including those in subgroups.

### Asynchronous Cloning

The script processes multiple repositories simultaneously, reducing the overall cloning time.

### CI/CD Integration

Integrate the tool into CI/CD pipelines to automatically update local copies of repositories.

## License

This project is licensed under the MIT License. Use freely.

"""Interactive CLI UI using Rich library for gitlab-dump operations."""

from __future__ import annotations

import getpass as _getpass_module
import logging
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table
from rich.text import Text

from .author_mapper import AuthorMapper
from .models import AuthorMapping, CommitterMapping, MigrationConfig

logger = logging.getLogger(__name__)
console = Console()


class CLIMenu:
    """Interactive menu system for gitlab-dump CLI."""

    def __init__(self):
        """Initialize CLI menu."""
        self.console = Console()

    def show_main_menu(self) -> str:
        """Display main menu and return user choice.

        Returns:
            User's choice: 'clone', 'migrate', 'history', or 'exit'
        """
        self.console.clear()
        self.console.print(
            Panel(
                "[bold cyan]gitlab-dump[/bold cyan] - Repository Manager",
                style="cyan",
            )
        )

        choices = ["Clone repositories", "Migrate repositories", "View history", "Exit"]
        for i, choice in enumerate(choices, 1):
            self.console.print(f"[cyan]{i}[/cyan] {choice}")

        while True:
            try:
                selection = self.console.input(
                    "\n[cyan]Select an option[/cyan] (1-4): "
                ).strip()
                idx = int(selection) - 1
                if 0 <= idx < len(choices):
                    mapping = ["clone", "migrate", "history", "exit"]
                    return mapping[idx]
                self.console.print("[red]Invalid selection. Please try again.[/red]")
            except ValueError:
                self.console.print("[red]Please enter a number between 1 and 4.[/red]")

    def show_clone_menu(self) -> dict[str, Any]:
        """Display clone repository menu.

        Returns:
            Dictionary with clone configuration
        """
        self.console.print("\n[bold cyan]Clone Repositories[/bold cyan]")

        gitlab_url = Prompt.ask("[cyan]GitLab URL[/cyan]")
        gitlab_token = _getpass_module.getpass("[cyan]GitLab token (hidden)[/cyan]: ")
        group_or_user = Prompt.ask("[cyan]Group or user[/cyan]", default="")
        clone_path = Prompt.ask(
            "[cyan]Clone path[/cyan]",
            default=str(Path.home() / "repositories"),
        )

        return {
            "url": gitlab_url,
            "token": gitlab_token,
            "group": group_or_user if group_or_user else None,
            "clone_path": clone_path,
        }

    def show_migration_wizard(self) -> MigrationConfig | None:
        """Display migration wizard for interactive setup.

        Returns:
            MigrationConfig instance or None if cancelled
        """
        self.console.print("\n[bold cyan]Migration Wizard[/bold cyan]")

        # Step 1: Select source repos
        source_path = Prompt.ask("[cyan]Source repositories path[/cyan]")
        if not Path(source_path).exists():
            self.console.print(
                f"[red]Path does not exist: {source_path}[/red]"
            )
            return None

        # Step 2: Select target hosting
        target_url = Prompt.ask("[cyan]Target GitLab/Git hosting URL[/cyan]")
        target_token = _getpass_module.getpass(
            "[cyan]Target hosting token (hidden)[/cyan]: "
        )

        # Step 3: Configure author mappings
        author_mappings = self._configure_author_mappings()

        # Step 4: Configure committer mappings
        committer_mappings = self._configure_committer_mappings()

        # Step 5: Preview configuration
        self._preview_migration_config(
            source_path, target_url, author_mappings, committer_mappings
        )

        if not Confirm.ask("\n[cyan]Proceed with this configuration?[/cyan]"):
            self.console.print("[yellow]Migration cancelled.[/yellow]")
            return None

        return MigrationConfig(
            source_repos_path=source_path,
            target_hosting_url=target_url,
            target_token=target_token,
            author_mappings=author_mappings,
            committer_mappings=committer_mappings,
        )

    def _configure_author_mappings(self) -> dict[str, AuthorMapping]:
        """Configure author mappings interactively.

        Returns:
            Dictionary of AuthorMapping instances
        """
        self.console.print("\n[cyan]Configure Author Mappings[/cyan]")
        mappings: dict[str, AuthorMapping] = {}
        mapping_num = 1

        while True:
            if not Confirm.ask(
                f"\n[cyan]Add author mapping #{mapping_num}?[/cyan]", default=True
            ):
                break

            orig_email = Prompt.ask("[cyan]Original email[/cyan]")
            orig_name = Prompt.ask("[cyan]Original name[/cyan]", default="")
            new_email = Prompt.ask("[cyan]New email[/cyan]")
            new_name = Prompt.ask("[cyan]New name[/cyan]", default="")

            key = f"mapping_{mapping_num}"
            mappings[key] = AuthorMapping(
                original_name=orig_name,
                original_email=orig_email,
                new_name=new_name,
                new_email=new_email,
            )
            mapping_num += 1

        return mappings

    def _configure_committer_mappings(self) -> dict[str, CommitterMapping]:
        """Configure committer mappings interactively.

        Returns:
            Dictionary of CommitterMapping instances
        """
        self.console.print("\n[cyan]Configure Committer Mappings[/cyan]")
        mappings: dict[str, CommitterMapping] = {}
        mapping_num = 1

        while True:
            if not Confirm.ask(
                f"\n[cyan]Add committer mapping #{mapping_num}?[/cyan]", default=True
            ):
                break

            orig_email = Prompt.ask("[cyan]Original email[/cyan]")
            orig_name = Prompt.ask("[cyan]Original name[/cyan]", default="")
            new_email = Prompt.ask("[cyan]New email[/cyan]")
            new_name = Prompt.ask("[cyan]New name[/cyan]", default="")

            key = f"mapping_{mapping_num}"
            mappings[key] = CommitterMapping(
                original_name=orig_name,
                original_email=orig_email,
                new_name=new_name,
                new_email=new_email,
            )
            mapping_num += 1

        return mappings

    def _preview_migration_config(
        self,
        source_path: str,
        target_url: str,
        author_mappings: dict[str, AuthorMapping],
        committer_mappings: dict[str, CommitterMapping],
    ) -> None:
        """Display migration configuration preview.

        Args:
            source_path: Path to source repositories
            target_url: Target Git hosting URL
            author_mappings: Author mappings dictionary
            committer_mappings: Committer mappings dictionary
        """
        self.console.print("\n[bold cyan]Migration Configuration Preview[/bold cyan]")

        config_text = f"""
[cyan]Source Path:[/cyan] {source_path}
[cyan]Target URL:[/cyan] {target_url}
[cyan]Author Mappings:[/cyan] {len(author_mappings)}
[cyan]Committer Mappings:[/cyan] {len(committer_mappings)}
"""
        self.console.print(Panel(config_text.strip(), border_style="cyan"))

        if author_mappings:
            table = Table(title="Author Mappings", show_header=True)
            table.add_column("Original Email", style="yellow")
            table.add_column("New Email", style="cyan")

            for mapping in author_mappings.values():
                table.add_row(mapping.original_email, mapping.new_email)

            self.console.print(table)

        if committer_mappings:
            table = Table(title="Committer Mappings", show_header=True)
            table.add_column("Original Email", style="yellow")
            table.add_column("New Email", style="cyan")

            for mapping in committer_mappings.values():
                table.add_row(mapping.original_email, mapping.new_email)

            self.console.print(table)

    def show_history_menu(self) -> str | None:
        """Display history viewing menu.

        Returns:
            Path to migration config file or None
        """
        self.console.print("\n[bold cyan]View Migration History[/bold cyan]")

        config_path = Prompt.ask(
            "[cyan]Migration config file path (JSON/YAML)[/cyan]"
        )

        try:
            mapper = AuthorMapper(config_path)
            config = mapper.load_migration_config()

            self.console.print("\n[bold cyan]Loaded Migration Configuration[/bold cyan]")
            self.console.print(
                f"[cyan]Source:[/cyan] {config.source_repos_path}"
            )
            self.console.print(f"[cyan]Target:[/cyan] {config.target_hosting_url}")
            self.console.print(
                f"[cyan]Author Mappings:[/cyan] {len(config.author_mappings)}"
            )
            self.console.print(
                f"[cyan]Committer Mappings:[/cyan] {len(config.committer_mappings)}"
            )

            return config_path
        except FileNotFoundError:
            self.console.print(
                f"[red]Config file not found: {config_path}[/red]"
            )
        except ValueError as e:
            self.console.print(f"[red]Invalid config: {e}[/red]")

        return None

    def save_migration_config(
        self, config: MigrationConfig, default_path: str | None = None
    ) -> str | None:
        """Save migration configuration to file.

        Args:
            config: MigrationConfig instance to save
            default_path: Default path for config file

        Returns:
            Path to saved config or None if cancelled
        """
        file_format = Prompt.ask(
            "[cyan]Config file format[/cyan]",
            choices=["json", "yaml"],
            default="json",
        )

        ext = ".json" if file_format == "json" else ".yaml"
        default_name = f"migration_config{ext}"

        if default_path:
            config_path = Prompt.ask(
                "[cyan]Config file path[/cyan]",
                default=str(Path(default_path) / default_name),
            )
        else:
            config_path = Prompt.ask(
                "[cyan]Config file path[/cyan]",
                default=default_name,
            )

        try:
            mapper = AuthorMapper(config_path)
            mapper.save_migration_config(config)
            self.console.print(
                f"[green]✓ Configuration saved to {config_path}[/green]"
            )
            return config_path
        except Exception as e:
            self.console.print(
                f"[red]Error saving configuration: {e}[/red]"
            )

        return None

    def show_success_message(self, message: str) -> None:
        """Display success message.

        Args:
            message: Message to display
        """
        self.console.print(f"\n[green]✓ {message}[/green]")

    def show_error_message(self, message: str) -> None:
        """Display error message.

        Args:
            message: Message to display
        """
        self.console.print(f"\n[red]✗ {message}[/red]")

    def show_info_message(self, message: str) -> None:
        """Display info message.

        Args:
            message: Message to display
        """
        self.console.print(f"\n[cyan]ℹ {message}[/cyan]")

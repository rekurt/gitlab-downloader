"""Tests for Electron frontend components."""

from pathlib import Path


def _get_component_path(component_name):
    """Get path to component file."""
    return Path(__file__).parent.parent / "electron" / "src" / "components" / f"{component_name}.js"


def _get_style_path(style_name):
    """Get path to style file."""
    return Path(__file__).parent.parent / "electron" / "src" / "styles" / f"{style_name}.css"


class TestElectronComponents:
    """Test suite for Electron React components."""

    def test_repo_list_component_exists(self):
        """Test that RepoList component file exists."""
        repo_list_path = _get_component_path("RepoList")
        assert repo_list_path.exists(), "RepoList.js component not found"

    def test_repo_list_has_required_functions(self):
        """Test that RepoList component has required functions."""
        repo_list_path = _get_component_path("RepoList")
        content = repo_list_path.read_text()

        assert "function RepoList" in content, "RepoList function not found"
        assert "fetch" in content, "fetch API not used"
        assert "selectedRepo" in content, "selectedRepo state not found"
        assert "onMigrationStart" in content, "onMigrationStart handler not found"

    def test_author_mapper_component_exists(self):
        """Test that AuthorMapper component file exists."""
        mapper_path = _get_component_path("AuthorMapper")
        assert mapper_path.exists(), "AuthorMapper.js component not found"

    def test_author_mapper_has_mapping_logic(self):
        """Test that AuthorMapper has mapping management logic."""
        mapper_path = _get_component_path("AuthorMapper")
        content = mapper_path.read_text()

        assert "function AuthorMapper" in content, "AuthorMapper function not found"
        assert "setMappings" in content, "setMappings state not found"
        assert "author" in content, "author type not found"
        assert "committer" in content, "committer type not found"
        assert "handleAddMapping" in content, "handleAddMapping function not found"
        assert "original_email" in content, "email mapping not found"

    def test_migration_wizard_component_exists(self):
        """Test that MigrationWizard component file exists."""
        wizard_path = _get_component_path("MigrationWizard")
        assert wizard_path.exists(), "MigrationWizard.js component not found"

    def test_migration_wizard_has_steps(self):
        """Test that MigrationWizard has step-by-step logic."""
        wizard_path = _get_component_path("MigrationWizard")
        content = wizard_path.read_text()

        assert "function MigrationWizard" in content, "MigrationWizard function not found"
        assert "step === 1" in content, "Step 1 not found"
        assert "step === 2" in content, "Step 2 not found"
        assert "step === 3" in content, "Step 3 not found"
        assert "step === 4" in content, "Step 4 not found"
        assert "AuthorMapper" in content, "AuthorMapper integration not found"

    def test_progress_indicator_component_exists(self):
        """Test that ProgressIndicator component file exists."""
        progress_path = _get_component_path("ProgressIndicator")
        assert progress_path.exists(), "ProgressIndicator.js component not found"

    def test_progress_indicator_has_polling(self):
        """Test that ProgressIndicator polls migration progress."""
        progress_path = _get_component_path("ProgressIndicator")
        content = progress_path.read_text()

        assert "function ProgressIndicator" in content
        assert "migration-progress" in content
        assert "setInterval" in content, "Polling mechanism not found"
        assert "migrationId" in content, "migrationId prop not found"

    def test_app_component_integration(self):
        """Test that App component integrates all sub-components."""
        app_path = Path(__file__).parent.parent / "electron" / "src" / "App.js"
        content = app_path.read_text()

        assert "RepoList" in content, "RepoList component not imported"
        assert "MigrationWizard" in content, "MigrationWizard component not imported"
        assert "handleMigrationStart" in content
        assert "currentView" in content, "View state management not found"

    def test_repo_list_css_exists(self):
        """Test that RepoList CSS file exists."""
        css_path = _get_style_path("RepoList")
        assert css_path.exists(), "RepoList.css not found"

    def test_author_mapper_css_exists(self):
        """Test that AuthorMapper CSS file exists."""
        css_path = _get_style_path("AuthorMapper")
        assert css_path.exists(), "AuthorMapper.css not found"

    def test_migration_wizard_css_exists(self):
        """Test that MigrationWizard CSS file exists."""
        css_path = _get_style_path("MigrationWizard")
        assert css_path.exists(), "MigrationWizard.css not found"

    def test_progress_indicator_css_exists(self):
        """Test that ProgressIndicator CSS file exists."""
        css_path = _get_style_path("ProgressIndicator")
        assert css_path.exists(), "ProgressIndicator.css not found"

    def test_app_css_updated(self):
        """Test that App.css has been updated for new layout."""
        css_path = Path(__file__).parent.parent / "electron" / "src" / "App.css"
        content = css_path.read_text()

        assert ".app-nav" in content, "Navigation styling not found"
        assert ".nav-button" in content, "Navigation button styling not found"
        assert ".header-status" in content, "Status display styling not found"
        assert ".status-indicator" in content, "Status indicator styling not found"

    def test_repo_list_api_integration(self):
        """Test that RepoList component uses API correctly."""
        repo_list_path = _get_component_path("RepoList")
        content = repo_list_path.read_text()

        assert "/api/repos" in content, "API endpoint not called"
        assert "repositories" in content, "Repository data not handled"
        assert "loading" in content, "Loading state not managed"

    def test_migration_wizard_api_integration(self):
        """Test that MigrationWizard uses migration API."""
        wizard_path = _get_component_path("MigrationWizard")
        content = wizard_path.read_text()

        assert "/api/migrate" in content, "Migration API endpoint not found"
        assert "repo_path" in content, "repo_path in API call not found"
        assert "migration_id" in content, "Migration ID handling not found"

    def test_components_have_error_handling(self):
        """Test that components have error handling."""
        repo_list_path = _get_component_path("RepoList")
        wizard_path = _get_component_path("MigrationWizard")

        for path in [repo_list_path, wizard_path]:
            content = path.read_text()
            assert "error" in content, f"Error handling not in {path.name}"
            assert "try" in content, f"Try block not in {path.name}"
            assert "catch" in content, f"Catch block not in {path.name}"

    def test_components_use_react_hooks(self):
        """Test that components use React hooks."""
        repo_list_path = _get_component_path("RepoList")
        mapper_path = _get_component_path("AuthorMapper")

        for path in [repo_list_path, mapper_path]:
            content = path.read_text()
            assert "useState" in content, f"useState not used in {path.name}"

    def test_components_export_correctly(self):
        """Test that components are exported correctly."""
        components = [
            "electron/src/components/RepoList.js",
            "electron/src/components/AuthorMapper.js",
            "electron/src/components/MigrationWizard.js",
            "electron/src/components/ProgressIndicator.js",
        ]

        for component_path in components:
            full_path = Path(__file__).parent.parent / component_path
            content = full_path.read_text()
            assert "export default" in content, f"Component not exported in {component_path}"

    def test_app_has_view_switching(self):
        """Test that App component properly switches between views."""
        app_path = Path(__file__).parent.parent / "electron" / "src" / "App.js"
        content = app_path.read_text()

        assert "currentView === 'repos'" in content, "Repos view condition not found"
        assert "currentView === 'migration'" in content, "Migration view condition not found"
        assert "setCurrentView" in content, "View switching mechanism not found"

    def test_components_responsive_design(self):
        """Test that CSS files have responsive design."""
        css_files = [
            "electron/src/styles/RepoList.css",
            "electron/src/styles/AuthorMapper.css",
            "electron/src/styles/MigrationWizard.css",
        ]

        for css_path in css_files:
            full_path = Path(__file__).parent.parent / css_path
            content = full_path.read_text()
            assert "@media" in content, f"Media queries not found in {css_path}"

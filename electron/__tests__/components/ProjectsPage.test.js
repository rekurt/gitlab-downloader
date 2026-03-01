import React from "react";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { App as AntApp } from "antd";
import ProjectsPage from "../../src/components/ProjectsPage";

function renderWithAntd(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

const mockProjects = [
  {
    id: 1,
    name: "project-alpha",
    path_with_namespace: "group/project-alpha",
    http_url_to_repo: "https://gitlab.com/group/project-alpha.git",
    last_activity_at: "2025-12-01T10:00:00Z",
  },
  {
    id: 2,
    name: "project-beta",
    path_with_namespace: "group/project-beta",
    http_url_to_repo: "https://gitlab.com/group/project-beta.git",
    last_activity_at: "2025-11-15T08:30:00Z",
  },
  {
    id: 3,
    name: "other-repo",
    path_with_namespace: "team/other-repo",
    http_url_to_repo: "https://gitlab.com/team/other-repo.git",
    last_activity_at: null,
  },
];

describe("ProjectsPage", () => {
  let mockFetchProjects;
  let mockCancelFetchProjects;
  let onCloneSelected;

  beforeEach(() => {
    mockFetchProjects = jest
      .fn()
      .mockResolvedValue({ success: true, projects: mockProjects });
    mockCancelFetchProjects = jest
      .fn()
      .mockResolvedValue({ success: true });
    onCloneSelected = jest.fn();

    window.electronAPI = {
      fetchProjects: mockFetchProjects,
      cancelFetchProjects: mockCancelFetchProjects,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("renders projects page with load button", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByTestId("load-projects-btn")).toBeInTheDocument();
  });

  test("shows group input when no group in settings", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });
    expect(screen.getByTestId("group-input")).toBeInTheDocument();
  });

  test("hides group input when group is in settings", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage
          settings={{ group: "my-group" }}
          onCloneSelected={onCloneSelected}
        />,
      );
    });
    expect(screen.queryByTestId("group-input")).not.toBeInTheDocument();
  });

  test("loads projects when button is clicked", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    await waitFor(() => {
      expect(mockFetchProjects).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("project-alpha")).toBeInTheDocument();
      expect(screen.getByText("project-beta")).toBeInTheDocument();
      expect(screen.getByText("other-repo")).toBeInTheDocument();
    });
  });

  test("passes group override to fetchProjects", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    const groupInput = screen.getByTestId("group-input");
    await act(async () => {
      fireEvent.change(groupInput, { target: { value: "my-custom-group" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    await waitFor(() => {
      expect(mockFetchProjects).toHaveBeenCalledWith({
        group: "my-custom-group",
      });
    });
  });

  test("shows error when fetch fails", async () => {
    mockFetchProjects.mockResolvedValue({
      success: false,
      error: "Authentication token is required",
    });

    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    await waitFor(() => {
      // Appears in both inline error and antd message notification
      const matches = screen.getAllByText("Authentication token is required");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("filters projects by search text", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    // Load projects first
    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    await waitFor(() => {
      expect(screen.getByText("project-alpha")).toBeInTheDocument();
    });

    // Type in search
    const searchInput = screen.getByTestId("search-input");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "alpha" } });
    });

    await waitFor(() => {
      expect(screen.getByText("project-alpha")).toBeInTheDocument();
      expect(screen.queryByText("project-beta")).not.toBeInTheDocument();
      expect(screen.queryByText("other-repo")).not.toBeInTheDocument();
    });
  });

  test("shows selected count and clone button", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    expect(screen.getByTestId("clone-selected-btn")).toBeInTheDocument();
    expect(screen.getByTestId("clone-selected-btn")).toBeDisabled();
    expect(screen.getByText(/0 of 0 projects selected/)).toBeInTheDocument();
  });

  test("clone selected button is disabled when no selection", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    const cloneBtn = screen.getByTestId("clone-selected-btn");
    expect(cloneBtn).toBeDisabled();
  });

  test("displays formatted dates", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    await waitFor(() => {
      expect(screen.getByText("project-alpha")).toBeInTheDocument();
    });

    // The null date should show "Unknown" tag
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  test("renders search input", async () => {
    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  test("handles cancel fetch", async () => {
    // Make fetch take forever
    mockFetchProjects.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      renderWithAntd(
        <ProjectsPage settings={{}} onCloneSelected={onCloneSelected} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-projects-btn"));
    });

    // Cancel button should appear
    await waitFor(() => {
      expect(screen.getByTestId("cancel-fetch-btn")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("cancel-fetch-btn"));
    });

    expect(mockCancelFetchProjects).toHaveBeenCalled();
  });
});

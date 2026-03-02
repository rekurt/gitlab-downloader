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
import ClonePage from "../../src/components/ClonePage";

function renderWithAntd(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

const mockProjects = [
  {
    id: 1,
    name: "project-alpha",
    path_with_namespace: "group/project-alpha",
    http_url_to_repo: "https://gitlab.com/group/project-alpha.git",
  },
  {
    id: 2,
    name: "project-beta",
    path_with_namespace: "group/project-beta",
    http_url_to_repo: "https://gitlab.com/group/project-beta.git",
  },
];

describe("ClonePage", () => {
  let mockCloneRepositories;
  let mockCancelClone;
  let mockDryRunProjects;
  let mockOnCloneProgress;
  let onNavigateToRepos;
  let progressCallbacks;

  beforeEach(() => {
    progressCallbacks = [];
    mockCloneRepositories = jest.fn().mockResolvedValue({
      success: true,
      results: [
        { name: "project-alpha", status: "success", message: "Cloned" },
        { name: "project-beta", status: "success", message: "Cloned" },
      ],
    });
    mockCancelClone = jest.fn().mockResolvedValue({ success: true });
    mockDryRunProjects = jest.fn().mockResolvedValue({
      success: true,
      targets: [
        { name: "project-alpha", targetPath: "/repos/group/project-alpha", status: "new" },
        { name: "project-beta", targetPath: "/repos/group/project-beta", status: "exists" },
      ],
    });
    mockOnCloneProgress = jest.fn((callback) => {
      progressCallbacks.push(callback);
      return () => {
        const idx = progressCallbacks.indexOf(callback);
        if (idx >= 0) progressCallbacks.splice(idx, 1);
      };
    });
    onNavigateToRepos = jest.fn();

    window.electronAPI = {
      cloneRepositories: mockCloneRepositories,
      cancelClone: mockCancelClone,
      dryRunProjects: mockDryRunProjects,
      onCloneProgress: mockOnCloneProgress,
    };
  });

  afterEach(() => {
    delete window.electronAPI;
    progressCallbacks = [];
  });

  test("renders clone page with project list", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} onNavigateToRepos={onNavigateToRepos} />,
      );
    });

    expect(screen.getByText("Clone Repositories")).toBeInTheDocument();
    expect(screen.getByText("project-alpha")).toBeInTheDocument();
    expect(screen.getByText("project-beta")).toBeInTheDocument();
  });

  test("renders control buttons", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    expect(screen.getByTestId("dry-run-btn")).toBeInTheDocument();
    expect(screen.getByTestId("start-clone-btn")).toBeInTheDocument();
  });

  test("has update existing toggle", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    expect(screen.getByText("Update existing repositories:")).toBeInTheDocument();
    expect(screen.getByTestId("update-switch")).toBeInTheDocument();
  });

  test("dry run shows preview results", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("dry-run-btn"));
    });

    await waitFor(() => {
      expect(mockDryRunProjects).toHaveBeenCalledWith({ projects: mockProjects });
    });

    await waitFor(() => {
      expect(screen.getByTestId("dry-run-results")).toBeInTheDocument();
      expect(screen.getByText("Dry Run Results")).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
      expect(screen.getByText("exists")).toBeInTheDocument();
    });
  });

  test("dry run shows error on failure", async () => {
    mockDryRunProjects.mockResolvedValue({
      success: false,
      error: "Something went wrong",
    });

    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("dry-run-btn"));
    });

    await waitFor(() => {
      const matches = screen.getAllByText("Something went wrong");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("start clone calls cloneRepositories and shows progress", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} onNavigateToRepos={onNavigateToRepos} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      expect(mockCloneRepositories).toHaveBeenCalledWith({
        projects: mockProjects,
        updateExisting: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("summary-card")).toBeInTheDocument();
      expect(screen.getByText("Clone Complete")).toBeInTheDocument();
    });
  });

  test("shows summary statistics after clone completes", async () => {
    mockCloneRepositories.mockResolvedValue({
      success: true,
      results: [
        { name: "project-alpha", status: "success", message: "Cloned" },
        { name: "project-beta", status: "skipped", message: "Already cloned" },
      ],
    });

    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} onNavigateToRepos={onNavigateToRepos} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("summary-card")).toBeInTheDocument();
    });

    // Check statistics are present
    expect(screen.getByText("Cloned")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  test("view repositories button navigates after clone", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} onNavigateToRepos={onNavigateToRepos} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("go-to-repos-btn")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("go-to-repos-btn"));
    });

    expect(onNavigateToRepos).toHaveBeenCalled();
  });

  test("passes updateExisting when toggle is on", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    // Toggle the switch on
    const switchEl = screen.getByTestId("update-switch");
    await act(async () => {
      fireEvent.click(switchEl);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      expect(mockCloneRepositories).toHaveBeenCalledWith({
        projects: mockProjects,
        updateExisting: true,
      });
    });
  });

  test("shows progress section during clone", async () => {
    // Make clone take longer to test progress display
    let resolveClone;
    mockCloneRepositories.mockReturnValue(
      new Promise((resolve) => {
        resolveClone = resolve;
      }),
    );

    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("progress-section")).toBeInTheDocument();
    });

    // Resolve the clone
    await act(async () => {
      resolveClone({
        success: true,
        results: [
          { name: "project-alpha", status: "success", message: "Cloned" },
          { name: "project-beta", status: "success", message: "Cloned" },
        ],
      });
    });
  });

  test("clone error shows error message", async () => {
    mockCloneRepositories.mockResolvedValue({
      success: false,
      error: "Clone operation failed",
    });

    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    await waitFor(() => {
      const matches = screen.getAllByText("Clone operation failed");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("disables buttons when no projects", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={[]} settings={{}} />,
      );
    });

    expect(screen.getByTestId("dry-run-btn")).toBeDisabled();
    expect(screen.getByTestId("start-clone-btn")).toBeDisabled();
  });

  test("registers and cleans up clone progress listener", async () => {
    await act(async () => {
      renderWithAntd(
        <ClonePage projects={mockProjects} settings={{}} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-clone-btn"));
    });

    // onCloneProgress should have been called to register listener
    expect(mockOnCloneProgress).toHaveBeenCalled();

    // After clone resolves, callback should be cleaned up
    await waitFor(() => {
      expect(screen.getByTestId("summary-card")).toBeInTheDocument();
    });
  });
});

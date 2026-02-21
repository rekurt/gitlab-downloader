/**
 * API client service for communicating with Python backend
 * Provides methods for all backend API calls
 */

class APIClient {
  constructor(endpoint = null) {
    this.endpoint = endpoint;
    this.initialized = false;
    this.retries = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000;
  }

  /**
   * Initialize the API client with endpoint from main process
   */
  async initialize() {
    try {
      if (window.electronAPI) {
        this.endpoint = await window.electronAPI.getApiEndpoint();
        this.initialized = true;
        console.log(`API client initialized with endpoint: ${this.endpoint}`);
        return true;
      }
    } catch (error) {
      console.error("Failed to initialize API client:", error);
    }
    return false;
  }

  /**
   * Check if API backend is available with retries
   */
  async checkStatus() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (window.electronAPI) {
        const isAvailable = await window.electronAPI.checkApiStatus();
        if (isAvailable) {
          this.retries = 0;
          return { status: "ok", available: true };
        }
      }

      if (this.retries < this.maxRetries) {
        this.retries += 1;
        await this.delay(this.retryDelay);
        return this.checkStatus();
      }

      return { status: "error", available: false };
    } catch (error) {
      console.error("Status check failed:", error);
      return { status: "error", available: false, error: error.message };
    }
  }

  /**
   * Make a generic fetch request to the API
   */
  async fetch(endpoint, options = {}) {
    if (!this.initialized) {
      throw new Error("API client not initialized");
    }

    const url = `${this.endpoint}${endpoint}`;
    const defaultOptions = {
      headers: {
        "Content-Type": "application/json",
      },
    };

    try {
      const response = await fetch(url, {
        ...defaultOptions,
        ...options,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get API status
   */
  async getStatus() {
    return this.fetch("/api/status");
  }

  /**
   * Get list of cloned repositories
   */
  async getRepositories() {
    return this.fetch("/api/repos");
  }

  /**
   * Get saved author mappings
   */
  async getAuthorMappings() {
    return this.fetch("/api/author-mappings");
  }

  /**
   * Save author mappings
   */
  async saveAuthorMappings(mappings) {
    return this.fetch("/api/author-mappings", {
      method: "POST",
      body: JSON.stringify(mappings),
    });
  }

  /**
   * Start migration task
   */
  async startMigration(config) {
    return this.fetch("/api/migrate", {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  /**
   * Get migration progress
   */
  async getMigrationProgress(migrationId) {
    return this.fetch(`/api/migration-progress/${migrationId}`);
  }

  /**
   * Utility method for delays
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Create a singleton instance
const apiClient = new APIClient();

export default apiClient;

import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import { createTestDir } from "@/util/test/createTestDir";
import { fileExists } from "./fileExists";

describe("fileExists", () => {
  test("returns true when file exists", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const filePath = join(testDir, "test-file.txt");
    
    try {
        await writeFile(filePath, "test content");

        const result = await fileExists({ filePath });

        expect(result).toBe(true);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("returns false when file does not exist", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const filePath = join(testDir, "nonexistent.txt");
    
    try {

        const result = await fileExists({ filePath });

        expect(result).toBe(false);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles relative paths", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const originalCwd = process.cwd();
    
    try {
        await writeFile(join(testDir, "relative-file.txt"), "test content");
        process.chdir(testDir);

        const result = await fileExists({ filePath: "./relative-file.txt" });

        expect(result).toBe(true);
    } finally {
        process.chdir(originalCwd);
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles paths with special characters", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const specialPath = join(testDir, "file with spaces & symbols!.txt");
    
    try {
        await writeFile(specialPath, "test content");

        const result = await fileExists({ filePath: specialPath });

        expect(result).toBe(true);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("returns false for directories", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const subDir = join(testDir, "subdirectory");
    
    try {
        await mkdir(subDir, { recursive: true });

        // Should return false for directories since it checks for files
        const result = await fileExists({ filePath: subDir });

        expect(result).toBe(false);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles deeply nested files", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const deepPath = join(testDir, "level1", "level2", "level3", "deep-file.txt");
    
    try {
        await mkdir(join(testDir, "level1", "level2", "level3"), { recursive: true });
        await writeFile(deepPath, "deep content");

        const result = await fileExists({ filePath: deepPath });

        expect(result).toBe(true);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles empty files", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const emptyFile = join(testDir, "empty.txt");
    
    try {
        await writeFile(emptyFile, "");

        const result = await fileExists({ filePath: emptyFile });

        expect(result).toBe(true);
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles file in parent directory", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    const subDir = join(testDir, "subdir");
    const fileInParent = join(testDir, "parent-file.txt");
    const originalCwd = process.cwd();
    
    try {
        await mkdir(subDir, { recursive: true });
        await writeFile(fileInParent, "test content");
        
        // Change to subdirectory
        process.chdir(subDir);
        
        // Check file in parent directory using relative path
        const result = await fileExists({ filePath: "../parent-file.txt" });

        expect(result).toBe(true);
    } finally {
        process.chdir(originalCwd);
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles files with various extensions", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    
    try {
        
        const files = [
            "file.txt",
            "file.json",
            "file.tar.gz",
            "file",
            ".hiddenfile",
            "file.with.many.dots.txt"
        ];
        
        // Create all files
        for (const file of files) {
            await writeFile(join(testDir, file), "content");
        }
        
        // Check all files exist
        for (const file of files) {
            const result = await fileExists({ filePath: join(testDir, file) });
            expect(result).toBe(true);
        }
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

test("handles multiple file existence checks", async () => {
    const { path: testDir } = await createTestDir({ functionName: "fileExists" });
    
    try {
        
        // Create some files
        const files = [
            { path: join(testDir, "file1.txt"), exists: true },
            { path: join(testDir, "file2.txt"), exists: false },
            { path: join(testDir, "file3.txt"), exists: true }
        ];

        for (const file of files) {
            if (file.exists) {
                await writeFile(file.path, "content");
            }
        }

        // Check all files
        for (const file of files) {
            const result = await fileExists({ filePath: file.path });
            expect(result).toBe(file.exists);
        }
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});
});
import uvicorn

if __name__ == "__main__":
    # Do NOT use reload=True on Windows — uvicorn's reload subprocess
    # forces SelectorEventLoop which breaks Playwright's subprocess calls.
    uvicorn.run("main:app", host="127.0.0.1", port=8001)

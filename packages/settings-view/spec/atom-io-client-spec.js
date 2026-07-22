const AtomIoClient = require("../lib/atom-io-client");

describe("AtomIoClient", function () {
  beforeEach(function () {
    return (this.client = new AtomIoClient());
  });

  it("fetches avatar from cache if the network is unavailable", function () {
    spyOn(this.client, "online").andReturn(false);
    spyOn(this.client, "fetchAndCacheAvatar");
    expect(this.client.fetchAndCacheAvatar).not.toHaveBeenCalled();
    return this.client.avatar("test-user", function () {});
  });

  it("handles glob errors", function () {
    // The glob library no longer lists directories through the callback `fs`
    // API, so inject the failure at the client's own glob seam.
    spyOn(this.client, "glob").andReturn(Promise.reject(new Error("readdir error")));

    const callback = jasmine.createSpy("cacheAvatar callback");
    this.client.cachedAvatar("fakeperson", callback);

    waitsFor(() => callback.callCount === 1);

    return runs(() => expect(callback.argsForCall[0][0].message).toBe("readdir error"));
  });

  return xit("purges old items from cache correctly");
});
// "correctly" in this case means "remove all old items but one" so that we
// always have stale data to return if the network is gone.

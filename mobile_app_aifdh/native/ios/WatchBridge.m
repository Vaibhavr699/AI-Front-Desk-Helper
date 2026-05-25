#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WatchBridge, NSObject)

RCT_EXTERN_METHOD(activateSession)
RCT_EXTERN_METHOD(sendMessage:(NSDictionary *)message
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

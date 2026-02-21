
if (!Module["ENVIRONMENT_IS_PTHREAD"]){
    function isMobileDevice(){
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    const MAX_MEMORY_MOBILE=1024*1024*1024;
    const MAX_MEMORY_DESKTOP=4*1024*1024*1024;
    const MAX_DEVICE_MEMORY=isMobileDevice() ? MAX_MEMORY_MOBILE : MAX_MEMORY_DESKTOP;
    Module['wasmMemory'] = new WebAssembly.Memory({"initial":16777216/65536,"maximum":MAX_DEVICE_MEMORY/65536,"shared":true});
}

require("dotenv").config();
const { fetchAvailableNumbers, purchaseNewNumber } = require("./lib/twilio");

async function main() {
    try {
        const numbers = await fetchAvailableNumbers();
        if (numbers.length > 0) {
            console.log("Will try to purchase:", numbers[0].phoneNumber);
            const res = await purchaseNewNumber(numbers[0].phoneNumber);
            console.log("Success:", res);
        } else {
            console.log("No numbers available");
        }
    } catch (err) {
        console.error("Error:", err);
    }
}
main();

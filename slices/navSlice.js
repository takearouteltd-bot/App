import { createSlice } from '@reduxjs/toolkit'

const initialState = {
    origin: null,
    destination: null,
    travelTimeInformation: null
}

export const navSlice = createSlice({
    name: 'nav',
    initialState,
    reducer: {
        setOrigin: (state, action) => {
            state.origin = action.payload;
        },
        setDestination: (state, action) => {
            state.destination = action.payload;
        },
        setTravelTimeInformation: (state, action) => {
            state.travelTimeInformation = action.payload;
        }
    }
})

export const { setOrigin, setDestination, setTravelTimeInformation} = navSlice.actions;

// Selectors

export const selectorOrigin = (state) => state.nav.origin;
export const selectorDestination = (state) => state.nav.destination;
export const selectorTravelTimeInformation = (state) => state.nav.travelTimeInformation;

export default navSlice.reducer;

